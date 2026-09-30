# OutOfMemoryError Crash Patterns

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| `OutOfMemory when trying to allocate` | 应用分配内存时超过 Heap 空间上限；手机设备主线程 OldSpaceSize 上限通常接近 350MB。 | 如果 OOM 堆栈稳定，优先分析高频调用和潜在泄漏路径；如果堆栈不稳定，通过 Snapshot 对比操作前后的内存快照定位泄漏对象。 |
| `AllocateHugeObject` | 尝试分配大对象时超过大对象空间阈值。 | 检查大数组、大字符串、大图片/缓存等一次性分配，拆分或释放不必要对象。 |
| `AllocateYoungOrHugeObject` | 年轻代或大对象空间分配失败，即使小对象也可能因堆空间耗尽失败。 | 排查生命周期过长对象、列表复用、缓存释放、组件销毁释放和闭包持有。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.

## Related Files

- [Fault mode library](./fault-mode-library.md) — OOM template with heap type breakdown
