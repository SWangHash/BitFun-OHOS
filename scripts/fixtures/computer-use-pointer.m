// Black-box lifecycle checks against the production passive AppKit cursor.
#import "../../src/apps/desktop/src/computer_use/macos_capture.m"
#include <assert.h>

void obf_control_native_stopped(uint64_t generation, int32_t pid, uint32_t windowID, const char *reason) {
    (void)generation; (void)pid; (void)windowID; (void)reason;
}

static void pump(double duration) {
    NSDate *until = [NSDate dateWithTimeIntervalSinceNow:duration];
    while (until.timeIntervalSinceNow > 0) {
        [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:until];
    }
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        pid_t foreground = NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier;
        NSWindow *target = [[NSWindow alloc] initWithContentRect:NSMakeRect(100, 100, 320, 240)
            styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
        target.title = @"BitFun Pointer Fixture";
        [target orderFrontRegardless];
        pump(0.1);
        double top = CGDisplayBounds(CGMainDisplayID()).size.height - NSMaxY(target.frame);
        obf_pointer_show((uint32_t)target.windowNumber, 180, top + 80, true);
        pump(0.05);
        if (!obfPointerPanel.visible) {
            fprintf(stderr, "pointer missing: target=%u targetOrigin=%.0f,%.0f offset=%.0f,%.0f panel=%p\n", obfPointerTarget, target.frame.origin.x, target.frame.origin.y, obfPointerOffset.x, obfPointerOffset.y, (__bridge void *)obfPointerPanel);
        }
        assert(obfPointerPanel.visible);
        assert(((OBFControlPointerView *)obfPointerPanel.contentView).click);
        pump(2.0);
        assert(obfPointerPanel.visible); // Old 700ms expiry must never return.
        assert(!((OBFControlPointerView *)obfPointerPanel.contentView).click);
        assert(!obfPointerPanel.keyWindow);
        if (argc == 2) {
            NSView *view = obfPointerPanel.contentView;
            NSBitmapImageRep *bitmap = [view bitmapImageRepForCachingDisplayInRect:view.bounds];
            [view cacheDisplayInRect:view.bounds toBitmapImageRep:bitmap];
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            assert([png writeToFile:[NSString stringWithUTF8String:argv[1]] atomically:YES]);
        }
        assert(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == foreground);
        NSPoint previous = obfPointerPanel.frame.origin;
        [target setFrameOrigin:NSMakePoint(120, 110)];
        pump(0.3);
        assert(fabs(obfPointerPanel.frame.origin.x - previous.x - 20) < 1);
        assert(fabs(obfPointerPanel.frame.origin.y - previous.y - 10) < 1);
        NSWindow *cover = [[NSWindow alloc] initWithContentRect:target.frame
            styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
        [cover orderFrontRegardless];
        pump(0.3);
        assert(!obfPointerPanel.visible);
        [cover orderOut:nil];
        pump(0.3);
        assert(obfPointerPanel.visible);
        // A failed retarget must not resurrect the old target's pointer.
        obf_pointer_show(UINT32_MAX, 0, 0, false);
        pump(0.3);
        assert(!obfPointerPanel.visible);
        obf_pointer_show((uint32_t)target.windowNumber, 200, top + 70, false);
        pump(0.2);
        assert(obfPointerPanel.visible);
        obf_pointer_hide();
        pump(0.1);
        assert(!obfPointerPanel.visible && obfPointerTimer == nil);
        assert(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier == foreground);
        [target orderOut:nil];
        puts("PASS pointer persists, click expires, follows target, hides behind cover, restores and stops without focus change");
    }
    return 0;
}
