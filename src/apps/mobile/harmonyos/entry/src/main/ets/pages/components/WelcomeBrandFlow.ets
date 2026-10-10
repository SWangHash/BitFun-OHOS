import { LengthMetricsUnit } from '@kit.ArkUI';
import { MotionPreference } from '../../services/MotionPreference';
import { INK, TRANSPARENT } from './Theme';
// The shared 256-unit diagonal mark, drawn as one silhouette with four
// subpaths. Kept in step with `design-system/assets/welcome-brand-contours.json`.
const MARK: string = "M66.560 16.000L67.840 16.000L67.840 32.640L70.400 48.000L74.240 59.520L82.560 74.240L96.000 88.960L131.200 115.840L147.840 131.840L152.960 138.880L158.720 152.320L158.720 168.960L151.680 183.040L137.600 195.200L122.880 201.600L113.920 203.520L101.760 202.880L108.800 201.600L120.960 195.840L130.560 187.520L134.400 181.760L136.960 174.720L137.600 165.760L132.480 151.040L122.240 138.880L88.320 112.000L71.040 96.000L58.880 80.640L51.840 64.000L50.560 44.160L52.480 35.840L58.880 23.680ZM52.480 82.560L58.240 95.360L65.280 104.960L80.000 119.040L113.280 143.360L126.720 157.440L130.560 166.400L130.560 176.000L126.720 184.960L119.040 192.640L112.640 195.200L117.120 188.160L117.120 179.200L111.360 168.320L103.040 161.280L71.680 141.440L56.320 124.800L51.200 114.560L48.640 103.040L49.280 91.520ZM199.680 116.480L206.720 117.120L212.480 120.320L223.360 120.960L232.960 124.800L211.840 123.520L200.960 126.720L191.360 132.480L172.800 163.200L158.080 178.560L162.560 169.600L163.200 161.280L172.160 150.400L184.960 126.080L191.360 119.040ZM111.360 179.200L112.640 179.200L113.280 182.400L112.640 188.160L106.240 197.120L93.440 202.880L58.240 211.200L39.680 218.880L26.240 229.760L19.840 240.640L24.320 223.360L30.720 211.840L35.200 207.360L42.880 202.880L54.400 199.040L97.280 190.720L106.240 186.240Z";
const MARK_LENGTH: number = 1261.949;

/** Desktop mark-flow effect; only highlights move, never the brand silhouette. */
@ComponentV2
export struct WelcomeBrandFlow {
  @Param markSize: number = 92;
  @Param sweep: boolean = false;
  private canvas: CanvasRenderingContext2D = new CanvasRenderingContext2D(new RenderingContextSettings(true), LengthMetricsUnit.PX);
  private paintSweep(): void {
    const color = this.getUIContext().getHostContext()?.resourceManager.getColorSync($r('app.color.ink').id) || 0;
    const r = (color >>> 16) & 255; const g = (color >>> 8) & 255; const b = color & 255;
    const ctx = this.canvas;
    const pixels = this.getUIContext().vp2px(this.markSize);
    ctx.clearRect(0, 0, pixels, pixels);
    ctx.save();ctx.scale(pixels / 256, pixels / 256);
    const shift = this.moving ? (Math.min(1, this.phase / 0.75) * 2 - 1) * 256 : 0;
    const gradient = ctx.createLinearGradient(shift, shift, 256 + shift, 256 + shift);
    gradient.addColorStop(0, `rgba(${r},${g},${b},0.16)`);
    gradient.addColorStop(0.46, `rgba(${r},${g},${b},0.25)`);
    gradient.addColorStop(0.55, `rgba(${r},${g},${b},1)`);
    gradient.addColorStop(0.65, `rgba(${r},${g},${b},0.25)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0.16)`);
    ctx.fillStyle = this.moving ? gradient : `rgb(${r},${g},${b})`;
    ctx.fill(new Path2D(MARK));
    ctx.restore();
  }
  @Local phase: number = 0;
  @Local moving: boolean = false;
  private timer: number = -1;
  aboutToDisappear(): void { this.stop(); }
  private stop(): void { if(this.timer>=0) clearInterval(this.timer);this.timer=-1; }
  private play(): void {
    this.stop();this.moving=!MotionPreference.reduceMotion();
    if(this.moving) this.timer=setInterval(()=>{const cycle=this.sweep?5000:18000;this.phase=(Date.now()%cycle)/cycle;if(this.sweep)this.paintSweep();},33);
    if(this.sweep)this.paintSweep();
  }
  build() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.sweep) {
        Canvas(this.canvas).width(this.markSize).height(this.markSize).onReady(() => this.paintSweep())
      } else {
      Shape() {
        Path().commands(MARK).fill(INK).opacity(0.25)
        if(this.moving) {
          ForEach([0.34,0.26,0.18],(length: number,layer: number)=>{
            Path().commands(MARK).fill(TRANSPARENT).stroke(INK).strokeWidth(px2vp(1))
              .strokeDashArray([px2vp(MARK_LENGTH*length/2),px2vp(MARK_LENGTH*(1-length)),px2vp(MARK_LENGTH*length/2),0])
              .strokeDashOffset(px2vp(-MARK_LENGTH*this.phase))
              .opacity(layer===2?0.36:layer===1?0.14:0.12)
          })
        }
      }.viewPort({ x: 0, y: 0, width: 256, height: 256 })
      .width(this.markSize).height(this.markSize)
      }
    }.width(this.markSize).height(this.markSize).accessibilityLevel('no-hide-descendants')
    .onVisibleAreaChange([0],(visible: boolean)=>{if(visible)this.play();else this.stop();})
  }
}
