// Desktop-only ScreenCaptureKit bridge. ARC owns native resources; Rust owns
// one retained session handle. No audio, global display capture, or HID input.
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreImage/CoreImage.h>
#include <stdlib.h>
#include <stdatomic.h>
#include <string.h>
extern void obf_control_native_stopped(uint64_t generation, int32_t pid, uint32_t windowID, const char *reason);

// Zero means the main-thread observer is not installed yet. Consumers must
// not cache focus preparation against that uninitialized value. Installation
// is asynchronous off-main to avoid waiting on AppKit while Rust owns CAPTURE.
static _Atomic(uint64_t) obfActivationEpoch = 0;
static void obf_install_activation_observer(void) {
    static dispatch_once_t scheduled;
    dispatch_once(&scheduled, ^{
        void (^install)(void) = ^{
            static id observer;
            observer = [NSWorkspace.sharedWorkspace.notificationCenter
                addObserverForName:NSWorkspaceDidActivateApplicationNotification
                object:nil queue:nil usingBlock:^(NSNotification *note) {
                    (void)note;
                    atomic_fetch_add_explicit(&obfActivationEpoch, 1, memory_order_release);
                }];
            if (observer) atomic_fetch_add_explicit(&obfActivationEpoch, 1, memory_order_release);
        };
        if (NSThread.isMainThread) install();
        else dispatch_async(dispatch_get_main_queue(), install);
    });
}
uint64_t obf_capture_activation_epoch(void) {
    return atomic_load_explicit(&obfActivationEpoch, memory_order_acquire);
}

@interface OBFWindowCapture : NSObject <SCStreamOutput, SCStreamDelegate>
@property(nonatomic, strong) SCStream *stream;
@property(nonatomic, strong) SCStreamConfiguration *configuration;
@property(nonatomic, strong) NSCondition *condition;
@property(nonatomic, strong) NSData *pixels;
@property(nonatomic, copy) NSString *failure;
@property(nonatomic) BOOL stopped;
@property(nonatomic) BOOL started;
@property(nonatomic) uint32_t width;
@property(nonatomic) uint32_t height;
@property(nonatomic) uint32_t windowID;
@property(nonatomic) pid_t pid;
@property(nonatomic) CGRect bounds;
@property(nonatomic) uint64_t sequence;
@property(nonatomic) uint64_t generation;
@property(nonatomic) CMTime lastObservedSample;
@property(nonatomic) CMTime inputBarrier;
@property(nonatomic) uint64_t receivedFrames;
@property(nonatomic) NSInteger lastFrameStatus;
@property(nonatomic, strong) CIContext *imageContext;
@end

@implementation OBFWindowCapture
- (instancetype)init {
    if ((self = [super init])) {
        _condition = [[NSCondition alloc] init];
        _lastObservedSample = kCMTimeInvalid;
        _inputBarrier = kCMTimeInvalid;
        _imageContext = [CIContext contextWithOptions:@{kCIContextUseSoftwareRenderer: @NO}];
    }
    return self;
}
- (void)fail:(NSString *)reason {
    [self.condition lock];
    self.stopped = YES;
    self.failure = reason ?: @"Capture stopped";
    self.pixels = nil;
    [self.condition broadcast];
    [self.condition unlock];
}
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
    [self fail:[NSString stringWithFormat:@"CAPTURE_STOPPED: %@", error.localizedDescription]];
    obf_control_native_stopped(self.generation, self.pid, self.windowID, self.failure.UTF8String);
}
// macOS 15.2+: a closed target must immediately revoke input, even if the
// framework keeps the stream available for a later reopened window.
- (void)streamDidBecomeInactive:(SCStream *)stream {
    [self fail:@"TARGET_WINDOW_UNAVAILABLE: Shared window became inactive"];
    obf_control_native_stopped(self.generation, self.pid, self.windowID, self.failure.UTF8String);
    [stream stopCaptureWithCompletionHandler:^(NSError *error) { (void)error; }];
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
    NSArray *attachments = (__bridge NSArray *)CMSampleBufferGetSampleAttachmentsArray(sample, NO);
    if (attachments.count == 0) return;
    NSNumber *status = attachments[0][SCStreamFrameInfoStatus];
    [self.condition lock];
    self.receivedFrames += 1;
    self.lastFrameStatus = status ? status.integerValue : -1;
    [self.condition unlock];
    CMTime observed = CMSampleBufferGetPresentationTimeStamp(sample);
    if (status && status.integerValue == SCFrameStatusIdle) {
        [self.condition lock];
        if (!self.stopped && CMTIME_IS_VALID(observed)) {
            self.lastObservedSample = observed;
            [self.condition broadcast];
        }
        [self.condition unlock];
        return;
    }
    if (status == nil || status.integerValue != SCFrameStatusComplete) return;
    CVPixelBufferRef buffer = CMSampleBufferGetImageBuffer(sample);
    if (!buffer) return;
    size_t width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer);
    if (!width || !height || width > 8192 || height > 8192) return;
    NSMutableData *pixels = [NSMutableData dataWithLength:width * height * 4];
    CIImage *image = [CIImage imageWithCVPixelBuffer:buffer];
    CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    [self.imageContext render:image toBitmap:pixels.mutableBytes rowBytes:width * 4
                       bounds:CGRectMake(0, 0, width, height) format:kCIFormatRGBA8 colorSpace:colorSpace];
    CGColorSpaceRelease(colorSpace);
    [self.condition lock];
    if (!self.stopped && width == self.configuration.width && height == self.configuration.height) {
        self.pixels = pixels;
        self.width = (uint32_t)width;
        self.height = (uint32_t)height;
        self.sequence += 1;
        self.lastObservedSample = observed;
        [self.condition broadcast];
    }
    [self.condition unlock];
}
@end

static void obf_error(char *buffer, size_t capacity, NSString *message) {
    if (buffer && capacity) snprintf(buffer, capacity, "%s", message.UTF8String ?: "Native capture error");
}

// Avoid Objective-C availability syntax here. Rust links this bridge with
// `-nodefaultlibs`, so clang's compiler-rt availability helper would remain
// unresolved in the final desktop binary. NSProcessInfo is available on our
// minimum deployment target and preserves the same runtime guard semantics.
static BOOL obf_os_at_least(NSInteger major, NSInteger minor) {
    NSOperatingSystemVersion version = NSProcessInfo.processInfo.operatingSystemVersion;
    return version.majorVersion > major ||
        (version.majorVersion == major && version.minorVersion >= minor);
}

// The lock fact is present on current macOS releases but is not a required
// dictionary key. Missing metadata is unknown, never proof that a session is
// locked; preserve ordinary capture errors in that case.
static BOOL obf_session_locked(void) {
    NSDictionary *session = CFBridgingRelease(CGSessionCopyCurrentDictionary());
    NSNumber *locked = session[@"CGSSessionScreenIsLocked"];
    return [locked isKindOfClass:NSNumber.class] && locked.boolValue;
}

// Choose a visible content window before considering hidden/minimized ones.
// Apps may keep a much larger off-screen utility window beside their real UI.
static SCWindow *obf_select_window(SCShareableContent *content, int32_t pid, uint32_t requestedWindow) {
    SCWindow *selected = nil;
    for (SCWindow *window in content.windows) {
        if (window.owningApplication.processID != pid || window.windowLayer != 0) continue;
        if (requestedWindow && window.windowID != requestedWindow) continue;
        if (window.frame.size.width < 1 || window.frame.size.height < 1) continue;
        if (!selected || (window.isOnScreen && !selected.isOnScreen) ||
            (window.isOnScreen == selected.isOnScreen &&
             window.frame.size.width * window.frame.size.height > selected.frame.size.width * selected.frame.size.height)) selected = window;
    }
    return selected;
}

// Occlusion is supported by desktop-independent capture. Hidden/minimized or
// another-Space windows can have no live surface; never suggest activation as
// automatic recovery, since that takes the human's foreground focus.
static NSString *obf_unavailable_surface(int32_t pid) {
    NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    if (app.hidden) return @"TARGET_APP_HIDDEN: The app is hidden; a live window surface is unavailable. Background control does not activate or unhide applications";
    return @"TARGET_SURFACE_UNAVAILABLE: Window is minimized, off the current Space, or ordered out; no live surface is available. Occluded windows are supported. Background control does not activate windows";
}

// Validate a replacement without stopping the currently authorized stream.
uint32_t obf_capture_validate_target(int32_t pid, uint32_t requestedWindow, char *error, size_t capacity) {
    @autoreleasepool {
        if ([NSThread isMainThread]) {
            obf_error(error, capacity, @"CAPTURE_WRONG_THREAD: Resolve capture on a worker thread");
            return 0;
        }
        if (obf_session_locked()) {
            obf_error(error, capacity, @"SESSION_LOCKED: Execution host screen is locked; capture and control are unavailable");
            return 0;
        }
        NSCondition *condition = [[NSCondition alloc] init];
        __block BOOL completed = NO;
        __block NSString *failure = nil;
        __block uint32_t resolvedWindow = 0;
        [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO
            completionHandler:^(SCShareableContent *content, NSError *contentError) {
            SCWindow *selected = obf_select_window(content, pid, requestedWindow);
            [condition lock];
            failure = contentError.localizedDescription;
            if (!failure && !selected) failure = @"TARGET_WINDOW_UNAVAILABLE: No capturable window matches the target";
            if (!failure && !selected.isOnScreen) failure = obf_unavailable_surface(pid);
            resolvedWindow = selected.windowID;
            completed = YES;
            [condition broadcast];
            [condition unlock];
        }];
        [condition lock];
        NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
        while (!completed && [condition waitUntilDate:deadline]) {}
        BOOL valid = completed && !failure;
        if (!valid) obf_error(error, capacity, failure ?: @"CAPTURE_TIMEOUT: Target discovery timed out; previous capture remains active");
        [condition unlock];
        return valid ? resolvedWindow : 0;
    }
}

// This entry must run off the AppKit main thread; the OS delivers completion
// asynchronously. Timed-out callbacks retain their object and stop late streams.
void *obf_capture_start(int32_t pid, uint32_t requestedWindow, uint64_t generation, char *error, size_t errorCapacity) {
    obf_install_activation_observer();
    @autoreleasepool {
        if (obf_os_at_least(12, 3)) {
            if ([NSThread isMainThread]) {
                obf_error(error, errorCapacity, @"CAPTURE_WRONG_THREAD: Start capture on a worker thread");
                return NULL;
            }
            if (obf_session_locked()) {
                obf_error(error, errorCapacity, @"SESSION_LOCKED: Execution host screen is locked; capture and control are unavailable");
                return NULL;
            }
            if (!CGPreflightScreenCaptureAccess()) {
                obf_error(error, errorCapacity, @"SCREEN_CAPTURE_PERMISSION_REQUIRED: Grant Screen Recording permission on the execution host");
                return NULL;
            }
            OBFWindowCapture *session = [[OBFWindowCapture alloc] init];
            session.pid = pid;
            session.generation = generation;
            [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:NO
                completionHandler:^(SCShareableContent *content, NSError *contentError) {
                if (contentError) { [session fail:contentError.localizedDescription]; return; }
                SCWindow *selected = obf_select_window(content, pid, requestedWindow);
                if (!selected) { [session fail:@"TARGET_WINDOW_UNAVAILABLE: No capturable window matches the target"]; return; }
                if (!selected.isOnScreen) { [session fail:obf_unavailable_surface(pid)]; return; }
                [session.condition lock];
                if (session.stopped) { [session.condition unlock]; return; }
                session.windowID = selected.windowID;
                session.bounds = selected.frame;
                SCContentFilter *filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:selected];
                SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
                config.width = (size_t)ceil(selected.frame.size.width);
                config.height = (size_t)ceil(selected.frame.size.height);
                config.minimumFrameInterval = CMTimeMake(1, 15);
                config.queueDepth = 3;
                config.showsCursor = NO;
                config.pixelFormat = kCVPixelFormatType_32BGRA;
                if (obf_os_at_least(13, 0)) config.capturesAudio = NO;
                if (obf_os_at_least(14, 0)) config.ignoreShadowsSingleWindow = YES;
                SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:session];
                session.stream = stream;
                session.configuration = config;
                [session.condition unlock];
                NSError *outputError = nil;
                dispatch_queue_t queue = dispatch_queue_create("com.openbitfun.computer-use.frames", DISPATCH_QUEUE_SERIAL);
                if (![stream addStreamOutput:session type:SCStreamOutputTypeScreen sampleHandlerQueue:queue error:&outputError]) {
                    [session fail:outputError.localizedDescription]; return;
                }
                [stream startCaptureWithCompletionHandler:^(NSError *startError) {
                    if (startError) { [session fail:startError.localizedDescription]; return; }
                    [session.condition lock];
                    BOOL cancelled = session.stopped;
                    session.started = !cancelled;
                    [session.condition broadcast];
                    [session.condition unlock];
                    if (cancelled) [stream stopCaptureWithCompletionHandler:^(NSError *e) { (void)e; }];
                }];
            }];
            [session.condition lock];
            NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:10];
            while (!session.stopped && (!session.started || !session.pixels)) {
                if (![session.condition waitUntilDate:deadline]) break;
            }
            if (session.stopped || !session.started || !session.pixels) {
                session.stopped = YES;
                obf_error(error, errorCapacity, session.failure ?: [NSString stringWithFormat:
                    @"CAPTURE_TIMEOUT: No complete window frame received (started=%d samples=%llu last_status=%ld configured=%zux%zu)",
                    session.started, session.receivedFrames, (long)session.lastFrameStatus,
                    session.configuration.width, session.configuration.height]);
                [session.condition unlock];
                SCStream *failedStream = session.stream;
                session.stream = nil;
                [failedStream removeStreamOutput:session type:SCStreamOutputTypeScreen error:NULL];
                [failedStream stopCaptureWithCompletionHandler:^(NSError *e) { (void)e; }];
                return NULL;
            }
            [session.condition unlock];
            return (__bridge_retained void *)session;
        }
        obf_error(error, errorCapacity, @"CAPTURE_UNSUPPORTED: ScreenCaptureKit requires macOS 12.3 or newer");
        return NULL;
    }
}

int obf_capture_status(void *handle, char *error, size_t capacity) {
    OBFWindowCapture *session = (__bridge OBFWindowCapture *)handle;
    if (obf_session_locked()) {
        [session fail:@"SESSION_LOCKED: Execution host screen is locked; start control again after unlocking"];
        obf_control_native_stopped(session.generation, session.pid, session.windowID, session.failure.UTF8String);
        [session.stream stopCaptureWithCompletionHandler:^(NSError *e) { (void)e; }];
        obf_error(error, capacity, session.failure);
        return 0;
    }
    CFArrayRef info = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, session.windowID);
    NSDictionary *window = [(__bridge NSArray *)info firstObject];
    CGRect frame = CGRectZero;
    BOOL valid = window && [window[(id)kCGWindowOwnerPID] intValue] == session.pid &&
        CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &frame);
    BOOL onScreen = [window[(id)kCGWindowIsOnscreen] boolValue];
    if (info) CFRelease(info);
    [session.condition lock];
    BOOL wasStopped = session.stopped;
    [session.condition unlock];
    if (!wasStopped && !valid) {
        [session fail:@"TARGET_WINDOW_UNAVAILABLE: Original target window is no longer capturable (closed or hidden)"];
        obf_control_native_stopped(session.generation, session.pid, session.windowID, session.failure.UTF8String);
        [session.stream stopCaptureWithCompletionHandler:^(NSError *e) { (void)e; }];
    }
    [session.condition lock];
    BOOL stopped = session.stopped;
    if (!stopped && !onScreen) {
        obf_error(error, capacity, obf_unavailable_surface(session.pid));
        [session.condition unlock];
        return 0;
    }
    if (stopped) obf_error(error, capacity, session.failure ?: @"CAPTURE_STOPPED");
    [session.condition unlock];
    return stopped ? 0 : 1;
}

// Cheap authoritative geometry read for input. It must not copy pixels or
// encode a preview, and movement must not leave input using cached origins.
int obf_capture_bounds(void *handle, double *bounds, char *error, size_t capacity) {
    if (!obf_capture_status(handle, error, capacity)) return 0;
    OBFWindowCapture *session = (__bridge OBFWindowCapture *)handle;
    CFArrayRef info = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, session.windowID);
    NSDictionary *window = [(__bridge NSArray *)info firstObject];
    CGRect frame = CGRectZero;
    BOOL valid = window && [window[(id)kCGWindowOwnerPID] intValue] == session.pid &&
        CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &frame);
    if (info) CFRelease(info);
    if (!valid) { obf_error(error, capacity, @"TARGET_WINDOW_UNAVAILABLE: Bound window no longer exists"); return 0; }
    bounds[0] = frame.origin.x; bounds[1] = frame.origin.y;
    bounds[2] = frame.size.width; bounds[3] = frame.size.height;
    return 1;
}

// Establish a presentation-time barrier after input. A queued pre-input frame
// cannot satisfy the next observation merely because it arrives late.
void obf_capture_mark_input(void *handle) {
    OBFWindowCapture *session = (__bridge OBFWindowCapture *)handle;
    [session.condition lock];
    session.inputBarrier = CMClockGetTime(CMClockGetHostTimeClock());
    [session.condition unlock];
}
static BOOL obf_frame_is_current(OBFWindowCapture *session) {
    return session.pixels && (!CMTIME_IS_VALID(session.inputBarrier) ||
        (CMTIME_IS_VALID(session.lastObservedSample) &&
         CMTimeCompare(session.lastObservedSample, session.inputBarrier) >= 0));
}

// malloc ownership transfers to Rust; freeing uses obf_capture_free.
int obf_capture_frame(void *handle, uint8_t **bytes, size_t *length, uint32_t *width,
                      uint32_t *height, uint32_t *windowID, double *bounds,
                      uint64_t *sequence, char *error, size_t capacity) {
    if (!obf_capture_status(handle, error, capacity)) return 0;
    OBFWindowCapture *session = (__bridge OBFWindowCapture *)handle;
    CFArrayRef info = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, session.windowID);
    NSDictionary *window = [(__bridge NSArray *)info firstObject];
    CGRect frame = CGRectZero;
    BOOL valid = window && [window[(id)kCGWindowOwnerPID] intValue] == session.pid &&
        CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &frame);
    if (info) CFRelease(info);
    if (!valid) [session fail:@"TARGET_WINDOW_UNAVAILABLE: Original target window is no longer capturable (closed or hidden)"];
    [session.condition lock];
    if (session.stopped) {
        obf_error(error, capacity, session.failure ?: @"CAPTURE_STOPPED");
        [session.condition unlock]; return 0;
    }
    size_t requestedWidth = (size_t)ceil(frame.size.width), requestedHeight = (size_t)ceil(frame.size.height);
    if (!requestedWidth || !requestedHeight || requestedWidth > 8192 || requestedHeight > 8192) {
        obf_error(error, capacity, @"TARGET_GEOMETRY_UNSUPPORTED: Window capture dimensions out of range");
        [session.condition unlock]; return 0;
    }
    if (requestedWidth != session.configuration.width || requestedHeight != session.configuration.height) {
        // A resized target needs a new complete frame. Old pixels must not be
        // labelled with the new coordinate basis while configuration settles.
        session.pixels = nil;
        session.configuration.width = requestedWidth;
        session.configuration.height = requestedHeight;
        SCStreamConfiguration *configuration = session.configuration;
        [session.condition unlock];
        [session.stream updateConfiguration:configuration completionHandler:^(NSError *updateError) {
            if (updateError) [session fail:updateError.localizedDescription];
        }];
        [session.condition lock];
    }
    session.bounds = frame;
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:5];
    while (!session.stopped && !obf_frame_is_current(session)) {
        if (![session.condition waitUntilDate:deadline]) break;
    }
    if (session.stopped || !obf_frame_is_current(session)) {
        obf_error(error, capacity, session.failure ?: @"CAPTURE_FRAME_UNAVAILABLE: No post-input frame or idle observation for the current window geometry");
        [session.condition unlock]; return 0;
    }
    *length = session.pixels.length;
    *bytes = malloc(*length);
    if (!*bytes) { obf_error(error, capacity, @"CAPTURE_ALLOCATION_FAILED"); [session.condition unlock]; return 0; }
    memcpy(*bytes, session.pixels.bytes, *length);
    *width = session.width; *height = session.height; *windowID = session.windowID;
    bounds[0] = frame.origin.x; bounds[1] = frame.origin.y;
    bounds[2] = frame.size.width; bounds[3] = frame.size.height;
    *sequence = session.sequence;
    [session.condition unlock];
    return 1;
}
void obf_capture_free(void *bytes) { free(bytes); }
void obf_capture_stop(void *handle) {
    if (!handle) return;
    OBFWindowCapture *session = (__bridge_transfer OBFWindowCapture *)handle;
    [session fail:@"CAPTURE_STOPPED: Control session ended"];
    SCStream *stream = session.stream;
    session.stream = nil;
    [stream removeStreamOutput:session type:SCStreamOutputTypeScreen error:NULL];
    [stream stopCaptureWithCompletionHandler:^(NSError *error) { (void)error; }];
}

// A passive session cursor. Its hotspot is (8, 8); the user's cursor is untouched.
@interface OBFControlPointerView : NSView
@property(nonatomic) BOOL click;
@end
@implementation OBFControlPointerView
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)rect {
    if (self.click) {
        NSBezierPath *ring = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(1, 1, 14, 14)];
        [[NSColor colorWithSRGBRed:166.0/255 green:166.0/255 blue:166.0/255 alpha:1] setStroke]; ring.lineWidth = 1.5; [ring stroke];
    }
    NSBezierPath *arrow = [NSBezierPath bezierPath];
    [arrow moveToPoint:NSMakePoint(8, 8)];
    [arrow curveToPoint:NSMakePoint(8, 15) controlPoint1:NSMakePoint(6, 10) controlPoint2:NSMakePoint(7, 12)];
    [arrow lineToPoint:NSMakePoint(14, 31)];
    [arrow curveToPoint:NSMakePoint(20.5, 31.5) controlPoint1:NSMakePoint(15.5, 35) controlPoint2:NSMakePoint(19, 35)];
    [arrow lineToPoint:NSMakePoint(23, 26)];
    [arrow curveToPoint:NSMakePoint(26, 23) controlPoint1:NSMakePoint(23.6, 24.5) controlPoint2:NSMakePoint(24.5, 23.6)];
    [arrow lineToPoint:NSMakePoint(31.5, 20.5)];
    [arrow curveToPoint:NSMakePoint(31, 14) controlPoint1:NSMakePoint(35, 19) controlPoint2:NSMakePoint(35, 15.5)];
    [arrow lineToPoint:NSMakePoint(15, 8)];
    [arrow curveToPoint:NSMakePoint(8, 8) controlPoint1:NSMakePoint(12, 7) controlPoint2:NSMakePoint(10, 6)];
    [arrow closePath];
    [NSGraphicsContext saveGraphicsState];
    NSShadow *shadow = [[NSShadow alloc] init];
    shadow.shadowColor = [NSColor colorWithWhite:0 alpha:0.45];
    shadow.shadowBlurRadius = 3;
    shadow.shadowOffset = NSMakeSize(0, -2);
    [shadow set];
    [[NSColor colorWithSRGBRed:166.0/255 green:166.0/255 blue:166.0/255 alpha:1] setFill];
    [arrow fill];
    [NSGraphicsContext restoreGraphicsState];
}
@end
static NSPanel *obfPointerPanel;
static NSTimer *obfPointerTimer;
static uint32_t obfPointerTarget;
static CGPoint obfPointerOffset;
static BOOL obfPointerHasOffset;
static NSTimeInterval obfPointerClickUntil;

static void obf_pointer_refresh(BOOL animate) {
    if (!obfPointerTarget) return;
    CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    NSArray *windows = CFBridgingRelease(raw);
    CGRect target = CGRectZero;
    for (NSDictionary *window in windows) {
        if ([window[(id)kCGWindowNumber] unsignedIntValue] == obfPointerTarget) {
            CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &target);
            break;
        }
    }
    if (CGRectIsEmpty(target)) { [obfPointerPanel orderOut:nil]; return; }
    // Follow window movement without moving the last point within its content.
    CGPoint point = CGPointMake(target.origin.x + obfPointerOffset.x, target.origin.y + obfPointerOffset.y);
    CGRect marker = CGRectMake(point.x - 8, point.y - 8, 40, 40);
    BOOL visible = NO;
    for (NSDictionary *window in windows) {
        uint32_t number = [window[(id)kCGWindowNumber] unsignedIntValue];
        if (obfPointerPanel && number == (uint32_t)obfPointerPanel.windowNumber) continue;
        if ([window[(id)kCGWindowAlpha] doubleValue] == 0) continue;
        // System sharing outlines are transparent and remain above this panel.
        if ([window[(id)kCGWindowLayer] integerValue] != 0) continue;
        CGRect frame = CGRectZero;
        if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &frame)) continue;
        if (!CGRectIntersectsRect(frame, marker)) continue;
        visible = number == obfPointerTarget && CGRectContainsRect(frame, marker);
        break;
    }
    if (!visible) { [obfPointerPanel orderOut:nil]; return; }
    if (!obfPointerPanel) {
        obfPointerPanel = [[NSPanel alloc] initWithContentRect:NSMakeRect(0, 0, 40, 40)
            styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
            backing:NSBackingStoreBuffered defer:NO];
        obfPointerPanel.opaque = NO;
        obfPointerPanel.backgroundColor = NSColor.clearColor;
        obfPointerPanel.ignoresMouseEvents = YES;
        obfPointerPanel.hasShadow = NO;
        obfPointerPanel.hidesOnDeactivate = NO;
        obfPointerPanel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
        obfPointerPanel.contentView = [[OBFControlPointerView alloc] initWithFrame:NSMakeRect(0, 0, 40, 40)];
    }
    OBFControlPointerView *view = (OBFControlPointerView *)obfPointerPanel.contentView;
    BOOL click = NSDate.timeIntervalSinceReferenceDate < obfPointerClickUntil;
    if (view.click != click) { view.click = click; view.needsDisplay = YES; }
    double primaryHeight = CGDisplayBounds(CGMainDisplayID()).size.height;
    NSPoint destination = NSMakePoint(point.x - 8, primaryHeight - point.y - 32);
    if (animate && obfPointerPanel.visible && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
        [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
            context.duration = 0.1;
            [[obfPointerPanel animator] setFrameOrigin:destination];
        } completionHandler:nil];
    } else {
        [obfPointerPanel setFrameOrigin:destination];
    }
    // Relative normal-level ordering never raises the target or overlays covering apps.
    [obfPointerPanel orderWindow:NSWindowAbove relativeTo:obfPointerTarget];
}

void obf_pointer_hide(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [obfPointerTimer invalidate]; obfPointerTimer = nil;
        obfPointerTarget = 0; obfPointerHasOffset = NO; obfPointerClickUntil = 0;
        [obfPointerPanel orderOut:nil];
    });
}
void obf_pointer_show(uint32_t targetWindow, double x, double y, bool click) {
    dispatch_async(dispatch_get_main_queue(), ^{
        BOOL sameTarget = obfPointerTarget == targetWindow;
        if (!sameTarget) {
            [obfPointerPanel orderOut:nil];
            obfPointerTarget = 0; obfPointerHasOffset = NO; obfPointerClickUntil = 0;
        }
        CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, targetWindow);
        NSArray *windows = CFBridgingRelease(raw);
        CGRect target = CGRectZero;
        for (NSDictionary *window in windows) {
            if ([window[(id)kCGWindowNumber] unsignedIntValue] == targetWindow) {
                CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)window[(id)kCGWindowBounds], &target);
                break;
            }
        }
        if (CGRectIsEmpty(target)) { [obfPointerPanel orderOut:nil]; return; }
        obfPointerTarget = targetWindow;
        obfPointerOffset = CGPointMake(x - target.origin.x, y - target.origin.y);
        obfPointerHasOffset = YES;
        if (click) obfPointerClickUntil = NSDate.timeIntervalSinceReferenceDate + 0.2;
        obf_pointer_refresh(sameTarget);
        if (!obfPointerTimer) {
            obfPointerTimer = [NSTimer timerWithTimeInterval:0.15 repeats:YES block:^(NSTimer *timer) {
                (void)timer;
                if (obfPointerHasOffset) obf_pointer_refresh(NO);
            }];
            [[NSRunLoop mainRunLoop] addTimer:obfPointerTimer forMode:NSRunLoopCommonModes];
        }
    });
}
