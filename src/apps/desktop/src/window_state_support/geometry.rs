use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Geometry {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

impl Geometry {
    pub(super) fn read(entry: &Value, maximized: bool) -> Option<Self> {
        let position = |current: &str, previous: &str| {
            let value = if maximized {
                entry.get(previous).or_else(|| entry.get(current))
            } else {
                entry.get(current)
            };
            i32::try_from(value?.as_i64()?).ok()
        };
        Some(Self {
            width: u32::try_from(entry["width"].as_u64()?).ok()?,
            height: u32::try_from(entry["height"].as_u64()?).ok()?,
            x: position("x", "prev_x")?,
            y: position("y", "prev_y")?,
        })
    }

    pub(super) fn write(self, entry: &mut Value) {
        for (key, value) in [
            ("width", json!(self.width)),
            ("height", json!(self.height)),
            ("x", json!(self.x)),
            ("y", json!(self.y)),
            ("prev_x", json!(self.x)),
            ("prev_y", json!(self.y)),
        ] {
            entry[key] = value;
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct Display {
    pub bounds: Geometry,
    pub scale: f64,
}

pub(super) struct Desktop(pub Vec<Display>);

impl Desktop {
    pub(super) fn read(window: &tauri::Window) -> Result<Self, String> {
        let primary = window
            .primary_monitor()
            .map_err(|error| error.to_string())?;
        let mut monitors = window
            .available_monitors()
            .map_err(|error| error.to_string())?;
        if let Some(primary) = primary {
            monitors.sort_by_key(|monitor| monitor.position() != primary.position());
        }
        let displays: Vec<_> = monitors
            .into_iter()
            .filter_map(|monitor| {
                let area = monitor.work_area();
                let scale = monitor.scale_factor();
                (area.size.width > 0 && area.size.height > 0 && scale.is_finite() && scale > 0.0)
                    .then_some(Display {
                        bounds: Geometry {
                            width: area.size.width,
                            height: area.size.height,
                            x: area.position.x,
                            y: area.position.y,
                        },
                        scale,
                    })
            })
            .collect();
        if displays.is_empty() {
            return Err("No usable monitor bounds; keeping saved window state".into());
        }
        Ok(Self(displays))
    }

    fn display(&self, geometry: Option<Geometry>) -> Display {
        geometry
            .and_then(|geometry| {
                self.0.iter().find(|display| {
                    let bounds = display.bounds;
                    i64::from(geometry.x) >= i64::from(bounds.x)
                        && i64::from(geometry.x) < i64::from(bounds.x) + i64::from(bounds.width)
                        && i64::from(geometry.y) >= i64::from(bounds.y)
                        && i64::from(geometry.y) < i64::from(bounds.y) + i64::from(bounds.height)
                })
            })
            .copied()
            .unwrap_or(self.0[0])
    }

    pub(super) fn minimum_size(&self, geometry: Geometry) -> (u32, u32) {
        let display = self.display(Some(geometry));
        (
            ((crate::MAIN_WINDOW_MIN_WIDTH * display.scale).ceil() as u32)
                .min(display.bounds.width),
            ((crate::MAIN_WINDOW_MIN_HEIGHT * display.scale).ceil() as u32)
                .min(display.bounds.height),
        )
    }

    pub(super) fn valid(&self, geometry: Geometry) -> bool {
        let (minimum_width, minimum_height) = self.minimum_size(geometry);
        if geometry.width < minimum_width || geometry.height < minimum_height {
            return false;
        }
        // Bound dimensions by the whole desktop, not just the primary monitor.
        // Allow native frame/shadow overhang (128 logical pixels).
        let left = self.0.iter().map(|d| i64::from(d.bounds.x)).min().unwrap();
        let top = self.0.iter().map(|d| i64::from(d.bounds.y)).min().unwrap();
        let right = self
            .0
            .iter()
            .map(|d| i64::from(d.bounds.x) + i64::from(d.bounds.width))
            .max()
            .unwrap();
        let bottom = self
            .0
            .iter()
            .map(|d| i64::from(d.bounds.y) + i64::from(d.bounds.height))
            .max()
            .unwrap();
        let margin = self
            .0
            .iter()
            .map(|d| (128.0 * d.scale).ceil() as i64)
            .max()
            .unwrap();
        if i64::from(geometry.width) > right - left + margin
            || i64::from(geometry.height) > bottom - top + margin
        {
            return false;
        }
        // A usable part of the top bar must intersect a real display. Intersecting
        // only the virtual desktop bounding box can land in a gap between screens.
        self.0.iter().any(|display| {
            let bounds = display.bounds;
            let grip_width = (64.0 * display.scale).ceil() as i64;
            let grip_height = (16.0 * display.scale).ceil() as i64;
            let bar_height = (48.0 * display.scale).ceil() as i64;
            let overlap_width = (i64::from(geometry.x) + i64::from(geometry.width))
                .min(i64::from(bounds.x) + i64::from(bounds.width))
                - i64::from(geometry.x).max(i64::from(bounds.x));
            let overlap_height = (i64::from(geometry.y) + bar_height)
                .min(i64::from(bounds.y) + i64::from(bounds.height))
                - i64::from(geometry.y).max(i64::from(bounds.y));
            overlap_width >= grip_width && overlap_height >= grip_height
        })
    }

    pub(super) fn default_geometry(&self, previous: Option<Geometry>) -> Geometry {
        let display = self.display(previous);
        let width = ((crate::MAIN_WINDOW_DEFAULT_WIDTH * display.scale).round() as u32)
            .min(display.bounds.width);
        let height = ((crate::MAIN_WINDOW_DEFAULT_HEIGHT * display.scale).round() as u32)
            .min(display.bounds.height);
        Geometry {
            width,
            height,
            x: (i64::from(display.bounds.x) + i64::from(display.bounds.width - width) / 2) as i32,
            y: (i64::from(display.bounds.y) + i64::from(display.bounds.height - height) / 2) as i32,
        }
    }
}
