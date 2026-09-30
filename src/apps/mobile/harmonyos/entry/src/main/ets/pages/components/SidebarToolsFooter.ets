import { MobileDesignTypography } from '../../generated/MobileDesignTokens';
import { RemoteI18n } from '../../i18n/RemoteI18n';
import { SIDEBAR_INK, SIDEBAR_LINE, SIDEBAR_RAISED } from './Theme';

/** Pure navigation controls reused in compact and wide sidebars. */
@ComponentV2
export struct SidebarToolsFooter {
  @Param toolsEnabled: boolean = false;
  @Event onOpenTools: () => void = () => {};
  @Event onOpenSettings: () => void = () => {};

  build() {
    Row() {
      Button() {
        Row({ space: 8 }) {
          Stack() {
            SymbolGlyph($r('sys.symbol.wrench_and_screwdriver'))
              .fontSize(20)
              .fontColor([SIDEBAR_INK])
          }.width(24).height(24)
          Text(RemoteI18n.t('workspaceTools.title'))
            .fontSize(MobileDesignTypography.labelLarge.size)
            .fontWeight(FontWeight.Medium)
            .fontColor(SIDEBAR_INK)
            .maxLines(1)
        }
      }
      .constraintSize({ minWidth: 104 })
      .height(48)
      .padding({ left: 14, right: 14 })
      .backgroundColor(SIDEBAR_RAISED)
      .border({ width: 0.5, color: SIDEBAR_LINE })
      .borderRadius(24)
      .enabled(this.toolsEnabled)
      .opacity(this.toolsEnabled ? 1 : 0.45)
      .accessibilityText(RemoteI18n.t('workspaceTools.title'))
      .stateEffect(true)
      .onClick(() => this.onOpenTools())
      Blank()
      Button() {
        SymbolGlyph($r('sys.symbol.gearshape'))
          .fontSize(20)
          .fontColor([SIDEBAR_INK])
      }
      .width(48)
      .height(48)
      .padding(0)
      .backgroundColor(SIDEBAR_RAISED)
      .borderRadius(24)
      .accessibilityText(RemoteI18n.t('settings.title'))
      .stateEffect(true)
      .onClick(() => this.onOpenSettings())
    }
    .width('100%')
    .height(56)
    .padding({ left: 12 })
    .alignItems(VerticalAlign.Center)
    .zIndex(2)
  }
}
