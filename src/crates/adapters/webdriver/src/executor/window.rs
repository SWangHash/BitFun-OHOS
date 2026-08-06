use crate::executor::BridgeExecutor;
use crate::platform::WindowRect;
use crate::server::response::WebDriverErrorResponse;

impl BridgeExecutor {
    pub(crate) async fn get_window_rect(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        self.state
            .window_host
            .get_rect(&self.session.current_window)
            .await
            .map_err(WebDriverErrorResponse::unknown_error)
    }

    pub(crate) async fn set_window_rect(
        &self,
        rect: WindowRect,
    ) -> Result<WindowRect, WebDriverErrorResponse> {
        self.state
            .window_host
            .set_rect(&self.session.current_window, rect)
            .await
            .map_err(WebDriverErrorResponse::unknown_error)
    }

    pub(crate) async fn maximize_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        self.state
            .window_host
            .maximize(&self.session.current_window)
            .await
            .map_err(WebDriverErrorResponse::unknown_error)
    }

    pub(crate) async fn minimize_window(&self) -> Result<(), WebDriverErrorResponse> {
        self.state
            .window_host
            .minimize(&self.session.current_window)
            .await
            .map_err(WebDriverErrorResponse::unknown_error)
    }

    pub(crate) async fn fullscreen_window(&self) -> Result<WindowRect, WebDriverErrorResponse> {
        self.state
            .window_host
            .fullscreen(&self.session.current_window)
            .await
            .map_err(WebDriverErrorResponse::unknown_error)
    }
}
