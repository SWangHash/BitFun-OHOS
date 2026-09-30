use log::{info, warn};
use bitfun_core::agentic::tools::computer_use_host::ComputerScreenshot;
use bitfun_core::infrastructure::try_get_path_manager_arc;
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

use chrono::Utc;

#[cfg(all(test, target_os = "macos"))]
mod native_fixture_tests {
    use super::*;

    /// Exercises the actual Vision backend and global-coordinate projection on
    /// a browser-rendered image, without capturing or operating the user's UI.
    #[test]
    #[ignore = "requires BITFUN_OCR_FIXTURE containing a rendered screenshot DTO"]
    fn native_vision_reads_rendered_fixture() {
        let path = std::env::var("BITFUN_OCR_FIXTURE").expect("rendered OCR fixture path");
        let shot: ComputerScreenshot =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let matches = macos::find_text_matches(&shot, "Save report").expect("real Vision OCR");
        let hit = &matches[0];
        assert!(hit.text.to_lowercase().contains("save report"), "{hit:?}");
        assert!(hit.confidence > 0.5, "{hit:?}");
        // Text is rendered at x=100..400, y=100..180 in an 800x600 image;
        // the DTO maps the image to (-500,100,400,300) global coordinates.
        assert!((-450.0..-300.0).contains(&hit.center_x), "{hit:?}");
        assert!((150.0..190.0).contains(&hit.center_y), "{hit:?}");
        assert!(hit.bounds_width > 0.0 && hit.bounds_height > 0.0);
        let all = read_text(&shot).expect("query-free Vision OCR");
        assert!(all
            .iter()
            .any(|line| line.text.to_lowercase().contains("save report")));
        assert!(
            all.iter()
                .any(|line| line.text.to_lowercase().contains("cancel")),
            "read-all must retain text unrelated to the locate query: {all:?}"
        );
        assert!(all
            .iter()
            .all(|line| line.center_x.is_finite() && line.center_y.is_finite()));
    }
}

pub(super) use bitfun_core::agentic::tools::computer_use_host::OcrTextMatch;

/// Read the best recognized text for every visible region. No search query,
/// candidate ranking, or debug pixel persistence is involved.
pub(super) fn read_text(shot: &ComputerScreenshot) -> BitFunResult<Vec<OcrTextMatch>> {
    #[cfg(target_os = "macos")]
    {
        return macos::read_text(shot);
    }
    #[cfg(target_os = "windows")]
    {
        return windows_backend::read_text(shot);
    }
    #[cfg(target_os = "linux")]
    {
        return linux_backend::read_text(shot);
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = shot;
        Err(BitFunError::tool(
            "[OCR_READ_UNSUPPORTED] Text reading is not available on this platform.",
        ))
    }
}

pub(super) fn find_text_matches(
    shot: &ComputerScreenshot,
    text_query: &str,
) -> BitFunResult<Vec<OcrTextMatch>> {
    let query = normalize_query(text_query)?;
    save_ocr_debug_jpeg(shot, &query);

    #[cfg(target_os = "macos")]
    {
        return macos::find_text_matches(shot, &query);
    }

    #[cfg(target_os = "windows")]
    {
        return windows_backend::find_text_matches(shot, &query);
    }

    #[allow(unreachable_code)]
    Err(BitFunError::tool(
        "move_to_text OCR is not supported on this platform.".to_string(),
    ))
}

/// Persist OCR input pixels only when explicitly enabled for local diagnosis.
fn ocr_debug_save_enabled() -> bool {
    ocr_debug_opt_in(
        std::env::var("BITFUN_COMPUTER_USE_OCR_DEBUG")
            .ok()
            .as_deref(),
    )
}

fn ocr_debug_opt_in(value: Option<&str>) -> bool {
    matches!(value, Some("1")) || value.is_some_and(|v| v.eq_ignore_ascii_case("true"))
}

#[cfg(test)]
mod debug_policy_tests {
    #[test]
    fn screenshot_persistence_requires_explicit_opt_in() {
        for value in [
            None,
            Some(""),
            Some("0"),
            Some("false"),
            Some("yes"),
            Some("2"),
        ] {
            assert!(!super::ocr_debug_opt_in(value));
        }
        for value in [Some("1"), Some("true"), Some("TRUE")] {
            assert!(super::ocr_debug_opt_in(value));
        }
    }
}

/// Same directory as agent `screenshot` debug (`workspace/.bitfun/computer_use_debug`), when PathManager is available.
fn computer_use_ocr_debug_dir() -> PathBuf {
    if let Ok(pm) = try_get_path_manager_arc() {
        return pm
            .default_assistant_workspace_dir(None)
            .join(bitfun_core_types::product_identity::hidden_data_directory())
            .join("computer_use_debug");
    }
    dirs::home_dir()
        .map(|h| {
            h.join(bitfun_core_types::product_identity::hidden_data_directory())
                .join("personal_assistant")
                .join("workspace")
                .join(bitfun_core_types::product_identity::hidden_data_directory())
                .join("computer_use_debug")
        })
        .unwrap_or_else(|| std::env::temp_dir().join("computer_use_debug"))
}

/// Persists `shot.bytes` (same buffer as Vision / WinRT / Tesseract) before OCR runs.
fn save_ocr_debug_jpeg(shot: &ComputerScreenshot, text_query: &str) {
    if !ocr_debug_save_enabled() {
        return;
    }
    let dir = computer_use_ocr_debug_dir();
    if let Err(e) = fs::create_dir_all(&dir) {
        warn!("computer_use ocr_debug: create_dir_all {:?}: {}", dir, e);
        return;
    }
    let safe: String = text_query
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .take(96)
        .collect();
    let safe = if safe.trim().is_empty() {
        "query".to_string()
    } else {
        safe
    };
    let ts = Utc::now().format("%Y%m%d_%H%M%S");
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let name = format!(
        "ocr_{}_{}_{}x{}_{}ms_{}.jpg",
        ts,
        ms,
        shot.image_width,
        shot.image_height,
        shot.bytes.len(),
        safe
    );
    let path = dir.join(name);
    match fs::File::create(&path).and_then(|mut f| f.write_all(&shot.bytes)) {
        Ok(()) => {
            info!(
                "computer_use ocr_debug: wrote {} bytes to {}",
                shot.bytes.len(),
                path.display()
            );
        }
        Err(e) => warn!("computer_use ocr_debug: write {:?}: {}", path, e),
    }
}

fn normalize_query(text_query: &str) -> BitFunResult<String> {
    let q = text_query.trim();
    if q.is_empty() {
        return Err(BitFunError::tool(
            "move_to_text requires a non-empty text_query.".to_string(),
        ));
    }
    Ok(q.to_string())
}

use super::ocr_context::*;

// ---------------------------------------------------------------------------
// macOS: Vision framework OCR via objc2-vision
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod macos {
    use super::{
        filter_and_rank, fuzzy_text_matches_query, image_box_to_global_match,
        image_content_rect_or_full, levenshtein_chars, normalize_for_match, OcrTextMatch,
    };
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSString};
    use objc2_vision::{
        VNImageOption, VNImageRectForNormalizedRect, VNImageRequestHandler, VNRecognizeTextRequest,
        VNRecognizeTextRequestRevision3, VNRecognizedTextObservation, VNRequest,
        VNRequestTextRecognitionLevel,
    };
    use bitfun_core::agentic::tools::computer_use_host::ComputerScreenshot;
    use bitfun_core::util::errors::{BitFunError, BitFunResult};

    /// Top-N candidates per observation; Chinese matches often appear below rank 1.
    const TOP_CANDIDATES_MAX: usize = 10;

    pub(super) fn read_text(shot: &ComputerScreenshot) -> BitFunResult<Vec<OcrTextMatch>> {
        let (_, _, width, height) = image_content_rect_or_full(shot);
        if width == 0 || height == 0 {
            return Err(BitFunError::tool(
                "Screenshot content rect is empty; cannot run macOS Vision OCR.",
            ));
        }
        let observations = recognize_text_observations(&shot.bytes)?;
        let mut output = Vec::with_capacity(observations.len());
        for observation in &observations {
            let candidates = observation.topCandidates(1);
            if candidates.is_empty() {
                continue;
            }
            let candidate = unsafe { candidates.objectAtIndex_unchecked(0) };
            let text = candidate.string().to_string();
            if text.trim().is_empty() {
                continue;
            }
            if let Some(hit) = project_observation(shot, observation, text, candidate.confidence())
            {
                output.push(hit);
            }
        }
        // Image coordinates have a top-left origin. Preserve each full line;
        // unlike a locate query, this is an observation rather than a ranking.
        output.sort_by(|a, b| {
            a.bounds_top
                .total_cmp(&b.bounds_top)
                .then_with(|| a.bounds_left.total_cmp(&b.bounds_left))
        });
        Ok(output)
    }

    pub(super) fn find_text_matches(
        shot: &ComputerScreenshot,
        text_query: &str,
    ) -> BitFunResult<Vec<OcrTextMatch>> {
        let (_content_left, _content_top, content_width, content_height) =
            image_content_rect_or_full(shot);
        if content_width == 0 || content_height == 0 {
            return Err(BitFunError::tool(
                "Screenshot content rect is empty; cannot run macOS Vision OCR.".to_string(),
            ));
        }

        let observations = recognize_text_observations(&shot.bytes)?;
        let mut raw_matches = Vec::new();
        for obs in &observations {
            if let Some(m) = observation_to_match(shot, text_query, obs) {
                raw_matches.push(m);
            }
        }

        let ranked = filter_and_rank(text_query, raw_matches);
        if ranked.is_empty() {
            return Err(BitFunError::tool(format!(
                "No OCR text matched {:?} on screen (macOS Vision found {} text regions total). \
                 Matching strips whitespace between glyphs and allows small edit distance for OCR errors. \
                 If the UI is Chinese, try a shorter substring or ensure the text is visible in the capture.",
                text_query,
                observations.len()
            )));
        }
        Ok(ranked)
    }

    fn recognize_text_observations(
        jpeg_bytes: &[u8],
    ) -> BitFunResult<Vec<Retained<VNRecognizedTextObservation>>> {
        // Create NSData from the raw JPEG bytes.
        let ns_data = NSData::with_bytes(jpeg_bytes);

        // Create the text recognition request.
        let request = VNRecognizeTextRequest::new();
        // Revision 3: language auto-detection + improved scripts (CJK).
        unsafe {
            let _: () = msg_send![&*request, setRevision: VNRecognizeTextRequestRevision3];
        }
        request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        request.setUsesLanguageCorrection(true);
        request.setAutomaticallyDetectsLanguage(true);

        // Prefer Simplified Chinese, Traditional Chinese, then English (WeChat / mixed UIs).
        let zh_hans = NSString::from_str("zh-Hans");
        let zh_hant = NSString::from_str("zh-Hant");
        let en_us = NSString::from_str("en-US");
        let langs = NSArray::from_retained_slice(&[zh_hans, zh_hant, en_us]);
        request.setRecognitionLanguages(&langs);

        request.setMinimumTextHeight(0.005);

        // Upcast VNRecognizeTextRequest -> VNImageBasedRequest -> VNRequest
        // via Retained::into_super() twice.
        let request_as_vn: Retained<VNRequest> =
            Retained::into_super(Retained::into_super(request.clone()));

        let requests = NSArray::from_retained_slice(&[request_as_vn]);

        // Build VNImageRequestHandler from NSData (JPEG).
        let options: Retained<NSDictionary<VNImageOption, objc2::runtime::AnyObject>> =
            NSDictionary::new();
        let handler = VNImageRequestHandler::initWithData_options(
            VNImageRequestHandler::alloc(),
            &ns_data,
            &options,
        );

        // Perform the request synchronously.
        handler
            .performRequests_error(&requests)
            .map_err(ns_error_to_bitfun)?;

        // Collect results.
        let results = match request.results() {
            Some(arr) => arr,
            None => return Ok(Vec::new()),
        };
        Ok(results.to_vec())
    }

    fn ns_error_to_bitfun(err: Retained<NSError>) -> BitFunError {
        let desc = err.localizedDescription().to_string();
        BitFunError::tool(format!("macOS Vision OCR failed: {}", desc))
    }

    fn observation_to_match(
        shot: &ComputerScreenshot,
        text_query: &str,
        obs: &VNRecognizedTextObservation,
    ) -> Option<OcrTextMatch> {
        let candidates = obs.topCandidates(TOP_CANDIDATES_MAX);
        let n = candidates.len();
        let q_norm = normalize_for_match(text_query);

        let mut chosen_text: Option<String> = None;
        let mut chosen_confidence: f32 = 0.0;

        for i in 0..n {
            let candidate = unsafe { candidates.objectAtIndex_unchecked(i) };
            let text = candidate.string().to_string();
            if !normalize_for_match(&text).contains(&q_norm) {
                continue;
            }
            let conf = candidate.confidence();
            if chosen_text.is_none() || conf > chosen_confidence {
                chosen_text = Some(text);
                chosen_confidence = conf;
            }
        }

        // Fuzzy fallback: Vision may insert spaces in CJK, mis-read one character, or split labels.
        if chosen_text.is_none() {
            let mut best: Option<(String, f32, usize)> = None;
            for i in 0..n {
                let candidate = unsafe { candidates.objectAtIndex_unchecked(i) };
                let text = candidate.string().to_string();
                if !fuzzy_text_matches_query(&text, text_query) {
                    continue;
                }
                let nt = normalize_for_match(&text);
                let dist = levenshtein_chars(&nt, &q_norm);
                let conf = candidate.confidence();
                let take = match &best {
                    None => true,
                    Some((_, bf, bd)) => dist < *bd || (dist == *bd && conf > *bf),
                };
                if take {
                    best = Some((text, conf, dist));
                }
            }
            if let Some((t, c, _)) = best {
                chosen_text = Some(t);
                chosen_confidence = c;
            }
        }

        let text = chosen_text?;
        project_observation(shot, obs, text, chosen_confidence)
    }

    fn project_observation(
        shot: &ComputerScreenshot,
        obs: &VNRecognizedTextObservation,
        text: String,
        confidence: f32,
    ) -> Option<OcrTextMatch> {
        // Vision bounding box is normalized to the **full** image (JPEG), not the content rect.
        let bounding = unsafe { obs.boundingBox() };
        let image_rect = unsafe {
            VNImageRectForNormalizedRect(
                bounding,
                shot.image_width as usize,
                shot.image_height as usize,
            )
        };

        // image_rect origin is bottom-left in image pixel space; convert to top-left.
        let local_left = image_rect.origin.x;
        let local_top = shot.image_height as f64 - image_rect.origin.y - image_rect.size.height;
        let width = image_rect.size.width;
        let height = image_rect.size.height;

        image_box_to_global_match(shot, text, confidence, local_left, local_top, width, height)
    }
}

// ---------------------------------------------------------------------------
// Windows: Windows.Media.Ocr UWP API
// ---------------------------------------------------------------------------
#[cfg(target_os = "windows")]
mod windows_backend {
    use super::{
        filter_and_rank, fuzzy_text_matches_query, image_box_to_global_match,
        image_content_rect_or_full, normalize_for_match, OcrTextMatch,
    };
    use bitfun_core::agentic::tools::computer_use_host::ComputerScreenshot;
    use bitfun_core::util::errors::{BitFunError, BitFunResult};
    use windows::core::HSTRING;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::{OcrEngine, OcrWord};
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::System::Com::{
        CoDecrementMTAUsage, CoIncrementMTAUsage, CoInitializeEx, CoUninitialize,
        COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };

    fn w<T>(r: windows::core::Result<T>) -> BitFunResult<T> {
        r.map_err(|e| BitFunError::tool(format!("Windows OCR: {}", e)))
    }

    pub(super) fn read_text(shot: &ComputerScreenshot) -> BitFunResult<Vec<OcrTextMatch>> {
        recognize(shot, None)
    }

    pub(super) fn find_text_matches(
        shot: &ComputerScreenshot,
        text_query: &str,
    ) -> BitFunResult<Vec<OcrTextMatch>> {
        recognize(shot, Some(text_query))
    }

    fn recognize(
        shot: &ComputerScreenshot,
        query: Option<&str>,
    ) -> BitFunResult<Vec<OcrTextMatch>> {
        let (content_left, content_top, content_width, content_height) =
            image_content_rect_or_full(shot);
        if content_width == 0 || content_height == 0 {
            return Err(BitFunError::tool(
                "Screenshot content rect is empty; cannot run Windows OCR.".to_string(),
            ));
        }

        // Initialize COM apartment for WinRT APIs
        // This must run on a thread initialized with COINIT_APARTMENTTHREADED
        // Windows.Media.Ocr requires STA thread
        let mut co_init = None;
        let mta_cookie = unsafe { CoIncrementMTAUsage() }.ok();
        if mta_cookie.is_none() {
            let hr =
                unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) };
            if hr.is_err() {
                return Err(BitFunError::tool(format!(
                    "Windows OCR COM initialization failed: {:?}",
                    hr
                )));
            }
            co_init = Some(());
        }

        let result = (|| -> BitFunResult<Vec<OcrTextMatch>> {
            // 1. Write JPEG bytes to in-memory stream
            let stream = w(InMemoryRandomAccessStream::new())?;
            let writer = w(DataWriter::CreateDataWriter(&stream))?;
            w(writer.WriteBytes(&shot.bytes))?;
            w(w(writer.StoreAsync())?.get())?;
            w(w(writer.FlushAsync())?.get())?;
            w(writer.DetachStream())?;

            // 2. Decode JPEG to SoftwareBitmap
            let decoder = w(w(BitmapDecoder::CreateAsync(&stream))?.get())?;
            let software_bitmap = w(w(decoder.GetSoftwareBitmapAsync())?.get())?;

            // 3. Create OCR engine (use user profile languages)
            let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
                Ok(e) => e,
                Err(_) => {
                    // Fallback to English if user profile languages fail
                    let lang = w(windows::Globalization::Language::CreateLanguage(
                        &HSTRING::from("en-US"),
                    ))?;
                    if !w(OcrEngine::IsLanguageSupported(&lang))? {
                        return Err(BitFunError::tool(
                            "Windows OCR: No supported language packs installed.".to_string(),
                        ));
                    }
                    w(OcrEngine::TryCreateFromLanguage(&lang))?
                }
            };

            // 4. Run OCR recognition
            let ocr_result = w(w(engine.RecognizeAsync(&software_bitmap))?.get())?;
            let lines = w(ocr_result.Lines())?;
            let line_count = w(lines.Size())?;

            let mut raw_matches = Vec::new();
            for line in &lines {
                let words = w(line.Words())?;
                if let Some(text_query) = query {
                    for word in &words {
                        if let Some(hit) = ocr_word_to_match(
                            shot,
                            text_query,
                            &word,
                            content_left,
                            content_top,
                            content_width,
                            content_height,
                        ) {
                            raw_matches.push(hit);
                        }
                    }
                } else {
                    let text = w(line.Text())?.to_string();
                    let mut bounds: Option<(f64, f64, f64, f64)> = None;
                    for word in &words {
                        let rect = w(word.BoundingRect())?;
                        let (left, top, right, bottom) = (
                            f64::from(rect.X),
                            f64::from(rect.Y),
                            f64::from(rect.X + rect.Width),
                            f64::from(rect.Y + rect.Height),
                        );
                        bounds = Some(match bounds {
                            None => (left, top, right, bottom),
                            Some((l, t, r, b)) => {
                                (l.min(left), t.min(top), r.max(right), b.max(bottom))
                            }
                        });
                    }
                    if let Some((left, top, right, bottom)) = bounds {
                        if !text.trim().is_empty() {
                            if let Some(hit) = image_box_to_global_match(
                                shot,
                                text,
                                0.8,
                                left,
                                top,
                                right - left,
                                bottom - top,
                            ) {
                                raw_matches.push(hit);
                            }
                        }
                    }
                }
            }
            let Some(text_query) = query else {
                raw_matches.sort_by(|a, b| {
                    a.bounds_top
                        .total_cmp(&b.bounds_top)
                        .then_with(|| a.bounds_left.total_cmp(&b.bounds_left))
                });
                return Ok(raw_matches);
            };

            let ranked = filter_and_rank(text_query, raw_matches);
            if ranked.is_empty() {
                return Err(BitFunError::tool(format!(
                    "No OCR text matched {:?} on screen (Windows OCR found {} text regions total).",
                    text_query, line_count
                )));
            }
            Ok(ranked)
        })();

        if let Some(cookie) = mta_cookie {
            let _ = unsafe { CoDecrementMTAUsage(cookie) };
        }
        // Uninitialize COM if we initialized it
        if co_init.is_some() {
            unsafe { CoUninitialize() };
        }

        result
    }

    fn ocr_word_to_match(
        shot: &ComputerScreenshot,
        text_query: &str,
        word: &OcrWord,
        _content_left: u32,
        _content_top: u32,
        _content_width: u32,
        _content_height: u32,
    ) -> Option<OcrTextMatch> {
        let text = word.Text().ok()?.to_string();

        // Pre-filter (same normalization + fuzzy as macOS / Linux)
        let nq = normalize_for_match(text_query);
        let nt = normalize_for_match(&text);
        if !nt.contains(&nq) && !fuzzy_text_matches_query(&text, text_query) {
            return None;
        }

        // Windows OCR returns bounding rect in pixels, top-left origin, within the image
        let rect = word.BoundingRect().ok()?;
        let local_left = f64::from(rect.X);
        let local_top = f64::from(rect.Y);
        let width = f64::from(rect.Width);
        let height = f64::from(rect.Height);

        image_box_to_global_match(shot, text, 0.8, local_left, local_top, width, height)
    }
}

// ---------------------------------------------------------------------------
// Linux: Tesseract OCR via leptess bindings
// ---------------------------------------------------------------------------
#[cfg(all(target_os = "linux", not(target_env = "ohos")))]
mod linux_backend {
    use super::{
        filter_and_rank, fuzzy_text_matches_query, image_box_to_global_match,
        image_content_rect_or_full, normalize_for_match, tesseract_lines_from_tsv, OcrTextMatch,
    };
    use leptess::capi::TessPageIteratorLevel_RIL_WORD;
    use leptess::{leptonica, tesseract::TessApi};
    use bitfun_core::agentic::tools::computer_use_host::ComputerScreenshot;
    use bitfun_core::util::errors::{BitFunError, BitFunResult};

    pub(super) fn read_text(shot: &ComputerScreenshot) -> BitFunResult<Vec<OcrTextMatch>> {
        recognize(shot, None)
    }

    pub(super) fn find_text_matches(
        shot: &ComputerScreenshot,
        text_query: &str,
    ) -> BitFunResult<Vec<OcrTextMatch>> {
        recognize(shot, Some(text_query))
    }

    fn recognize(
        shot: &ComputerScreenshot,
        query: Option<&str>,
    ) -> BitFunResult<Vec<OcrTextMatch>> {
        let (content_left, content_top, content_width, content_height) =
            image_content_rect_or_full(shot);
        if content_width == 0 || content_height == 0 {
            return Err(BitFunError::tool(
                "Screenshot content rect is empty; cannot run Linux Tesseract OCR.".to_string(),
            ));
        }

        // Initialize Tesseract API
        // Try system default tessdata path first, then common locations
        let mut api = match TessApi::new(None, "eng") {
            Ok(api) => api,
            Err(_) => {
                let paths = [
                    "/usr/share/tesseract-ocr/5/tessdata/",
                    "/usr/share/tesseract-ocr/tessdata/",
                    "/usr/share/tessdata/",
                ];
                let mut api = None;
                for path in &paths {
                    if std::path::Path::new(path).exists() {
                        if let Ok(a) = TessApi::new(Some(path), "eng") {
                            api = Some(a);
                            break;
                        }
                    }
                }
                api.ok_or_else(|| BitFunError::tool(
                    "Linux OCR: Tesseract initialization failed. Please install tesseract-ocr and tesseract-ocr-eng packages, or ensure TESSDATA_PREFIX is set correctly.".to_string()
                ))?
            }
        };

        let pix = leptonica::pix_read_mem(&shot.bytes).map_err(|e| {
            BitFunError::tool(format!(
                "Linux OCR: Failed to decode screenshot image with Leptonica: {}",
                e
            ))
        })?;

        api.set_image(&pix);
        if api.recognize() != 0 {
            return Err(BitFunError::tool(
                "Linux OCR: Tesseract recognition failed.".to_string(),
            ));
        }

        let Some(text_query) = query else {
            let tsv = api.get_tsv_text(0).map_err(|error| {
                BitFunError::tool(format!("Linux OCR: Invalid text encoding: {error}"))
            })?;
            return Ok(tesseract_lines_from_tsv(shot, &tsv));
        };

        let boxa = api
            .get_component_images(TessPageIteratorLevel_RIL_WORD, true)
            .ok_or_else(|| {
                BitFunError::tool(
                    "Linux OCR: Tesseract did not return word regions.".to_string(),
                )
            })?;

        let word_region_count = boxa.get_n();
        let mut raw_matches = Vec::new();

        for b in &boxa {
            let g = b.get_geometry();
            if g.w <= 0 || g.h <= 0 {
                continue;
            }
            let x1 = g.x;
            let y1 = g.y;
            let x2 = g.x + g.w;
            let y2 = g.y + g.h;
            api.set_rectangle(g.x, g.y, g.w, g.h);
            let text = match api.get_utf8_text() {
                Ok(t) => t,
                Err(_) => continue,
            };
            let confidence = api.mean_text_conf() as f32 / 100.0;
            if let Some(hit) = tesseract_word_to_match(
                shot,
                text_query,
                &text,
                confidence,
                x1,
                y1,
                x2,
                y2,
                content_left,
                content_top,
                content_width,
                content_height,
            ) {
                raw_matches.push(hit);
            }
        }

        let ranked = filter_and_rank(text_query, raw_matches);
        if ranked.is_empty() {
            return Err(BitFunError::tool(format!(
                "No OCR text matched {:?} on screen (Tesseract found {} word regions total).",
                text_query, word_region_count
            )));
        }
        Ok(ranked)
    }

    fn tesseract_word_to_match(
        shot: &ComputerScreenshot,
        text_query: &str,
        text: &str,
        confidence: f32,
        x1: i32,
        y1: i32,
        x2: i32,
        y2: i32,
        _content_left: u32,
        _content_top: u32,
        _content_width: u32,
        _content_height: u32,
    ) -> Option<OcrTextMatch> {
        let nq = normalize_for_match(text_query);
        let nt = normalize_for_match(text);
        if !nt.contains(&nq) && !fuzzy_text_matches_query(text, text_query) {
            return None;
        }

        // Tesseract returns bounding box in pixels, top-left origin, within the image
        let local_left = x1 as f64;
        let local_top = y1 as f64;
        let width = (x2 - x1) as f64;
        let height = (y2 - y1) as f64;

        if width <= 0.0 || height <= 0.0 {
            return None;
        }

        image_box_to_global_match(
            shot,
            text.to_string(),
            confidence,
            local_left,
            local_top,
            width,
            height,
        )
    }
}
