package com.bitfun.mobile.app.ui.shell

import android.graphics.Paint
import android.graphics.DashPathEffect
import androidx.core.graphics.PathParser
import androidx.compose.foundation.Canvas
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import kotlinx.coroutines.awaitCancellation
import kotlin.coroutines.coroutineContext

// The shared 256-unit diagonal mark, drawn as one silhouette with four
// subpaths. Kept in step with `design-system/assets/welcome-brand-contours.json`.
private const val MARK_PATH = "M66.560 16.000L67.840 16.000L67.840 32.640L70.400 48.000L74.240 59.520L82.560 74.240L96.000 88.960L131.200 115.840L147.840 131.840L152.960 138.880L158.720 152.320L158.720 168.960L151.680 183.040L137.600 195.200L122.880 201.600L113.920 203.520L101.760 202.880L108.800 201.600L120.960 195.840L130.560 187.520L134.400 181.760L136.960 174.720L137.600 165.760L132.480 151.040L122.240 138.880L88.320 112.000L71.040 96.000L58.880 80.640L51.840 64.000L50.560 44.160L52.480 35.840L58.880 23.680ZM52.480 82.560L58.240 95.360L65.280 104.960L80.000 119.040L113.280 143.360L126.720 157.440L130.560 166.400L130.560 176.000L126.720 184.960L119.040 192.640L112.640 195.200L117.120 188.160L117.120 179.200L111.360 168.320L103.040 161.280L71.680 141.440L56.320 124.800L51.200 114.560L48.640 103.040L49.280 91.520ZM199.680 116.480L206.720 117.120L212.480 120.320L223.360 120.960L232.960 124.800L211.840 123.520L200.960 126.720L191.360 132.480L172.800 163.200L158.080 178.560L162.560 169.600L163.200 161.280L172.160 150.400L184.960 126.080L191.360 119.040ZM111.360 179.200L112.640 179.200L113.280 182.400L112.640 188.160L106.240 197.120L93.440 202.880L58.240 211.200L39.680 218.880L26.240 229.760L19.840 240.640L24.320 223.360L30.720 211.840L35.200 207.360L42.880 202.880L54.400 199.040L97.280 190.720L106.240 186.240Z"
private const val MARK_LENGTH = 1261.949f

@Composable
internal fun WelcomeBrandFlow(modifier: Modifier, sweep: Boolean = false) {
    val path=remember { PathParser.createPathFromPathData(MARK_PATH)!! }
    val paint=remember { Paint(Paint.ANTI_ALIAS_FLAG).apply { style=Paint.Style.STROKE;strokeWidth=1f } }
    var moving by remember { mutableStateOf(false) }
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            moving=coroutineContext[androidx.compose.ui.MotionDurationScale]?.scaleFactor!=0f
            try { awaitCancellation() } finally { moving = false }
        }
    }
    // Use Compose's animation clock so tooling can recognize an infinite decorative
    // animation. A timer mutating state every 33 ms kept the entire UI perpetually busy.
    val animatedPhase = if (moving) rememberInfiniteTransition(label = "brand-flow").animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(if (sweep) 5000 else 18000, easing = LinearEasing), RepeatMode.Restart),
        label = "brand-phase",
    ) else remember { mutableFloatStateOf(0f) }
    val ink=MaterialTheme.colorScheme.onBackground
    Canvas(modifier) {
        val phase = animatedPhase.value
        drawIntoCanvas { canvas ->
            val c=canvas.nativeCanvas;c.save();c.scale(size.width/256,size.height/256);paint.color=ink.toArgb()
            if(sweep) {
                val shift=(minOf(1f,phase/.75f)*2-1)*256
                val colors=floatArrayOf(.16f,.25f,1f,.25f,.16f).map { alpha ->
                    ink.copy(alpha = if(moving) alpha else .5f).toArgb()
                }.toIntArray()
                paint.pathEffect=null;paint.alpha=255;paint.style=Paint.Style.FILL
                paint.shader=android.graphics.LinearGradient(shift,shift,256+shift,256+shift,colors,
                    floatArrayOf(0f,.46f,.55f,.65f,1f),android.graphics.Shader.TileMode.CLAMP)
                c.drawPath(path,paint);paint.shader=null
            } else {
                paint.pathEffect=null;paint.alpha=64;paint.style=Paint.Style.FILL
                c.drawPath(path,paint)
                paint.style=Paint.Style.STROKE
                if(moving) listOf(.34f,.26f,.18f).forEachIndexed { layer,length ->
                    paint.pathEffect=DashPathEffect(floatArrayOf(
                        MARK_LENGTH*length/2,MARK_LENGTH*(1-length),MARK_LENGTH*length/2,0f),-MARK_LENGTH*phase)
                    paint.alpha=(255*listOf(.12f,.14f,.36f)[layer]).toInt();c.drawPath(path,paint)
                }
            };c.restore()
        }
    }
}
