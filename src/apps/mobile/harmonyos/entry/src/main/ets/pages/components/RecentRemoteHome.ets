import { RemoteI18n } from '../../i18n/RemoteI18n';
import { MobileDesignGeometry, MobileDesignTypography } from '../../generated/MobileDesignTokens';
import { WelcomeBrandFlow } from './WelcomeBrandFlow';
import { INK, MUTED, SOFT } from './Theme';

/** Current-device landing page. Session activation stays with the remote owner. */
@ComponentV2
export struct RecentRemoteHome {
  @Param connected: boolean = false;
  @Param busy: boolean = false;
  @Event onBrowse: () => void = () => {};
  @Event onConnect: () => void = () => {};

  build() {
    Scroll() {
      Column() {
        Column() {
          WelcomeBrandFlow({ markSize: 156, sweep: true })
            .margin({ top: 20, bottom: 8 })
          Text(RemoteI18n.t('home.recent_title')).fontSize(MobileDesignTypography.headlineLarge.size)
            .fontWeight(FontWeight.Medium).fontColor(INK).textAlign(TextAlign.Center)
        }.width('100%').margin({ bottom: 32 })
        if (this.busy) {
          LoadingProgress().width(24).height(24).color(MUTED).margin({ bottom: 16 })
        }
        if (!this.connected) {
          Text(RemoteI18n.t('home.recent_connect')).fontSize(MobileDesignTypography.bodySmall.size).fontColor(MUTED).margin({ bottom: 16 })
          Button(RemoteI18n.t('home.connectComputer')).onClick(this.onConnect)
            .backgroundColor(SOFT).fontColor(INK).height(48).width('100%').margin({ bottom: 16 })
        }
        if (this.connected) {
          Button(RemoteI18n.t('sidebar.workspaces')).onClick(this.onBrowse)
            .backgroundColor(SOFT).fontColor(INK).height(48).width('100%')
        }

      }.alignItems(HorizontalAlign.Start).width('100%')
        .constraintSize({ maxWidth: MobileDesignGeometry.recentHomeMaxWidth })
        .padding({ left: MobileDesignGeometry.recentHomeGutter, right: MobileDesignGeometry.recentHomeGutter, bottom: 28 })
    }.width('100%').height('100%').align(Alignment.Top).scrollBar(BarState.Off)
  }
}
