# Frontend Review: 3 Issues Fix (DPI / Layout / targetHeight)

**Reviewer:** Frontend specialist (React / TypeScript / Canvas API)
**Date:** 2026-04-13
**Scope:** Tasks 4, 5 and cross-cutting frontend concerns from `2026-04-13-three-issues-fix.md`

---

## Verification Point Responses

### 1. devicePixelRatio retrieval timing and ResizeObserver on monitor move

**Verdict: Workable, but with a known gap.**

`window.devicePixelRatio` is read inside `draw()`, which is correct because it always picks up the latest value at paint time. When a Tauri window is dragged from a 1x display to a 2x display the CSS layout dimensions of the container do not change (assuming the window pixel size stays the same in OS coordinates), so **ResizeObserver will NOT fire**. The container's `clientWidth`/`clientHeight` remain identical; only the physical backing changes.

Chromium-based engines (which Tauri uses via WebView2) do fire a `resize` event on the `window` object when DPI changes, and they also trigger `matchMedia('(resolution: ...)')` listeners. However, ResizeObserver watches element CSS box sizes, not device pixels.

**Impact:** After a cross-monitor drag to a different DPI display, the canvas buffer will remain at the old DPI until the next `draw()` trigger (e.g., page navigation or window resize). The image will appear correct but at the wrong physical resolution -- blurry on a higher-DPI screen or over-sampled on a lower-DPI screen.

**Recommendation (Important):** Add a `matchMedia` listener for DPI changes:
```typescript
useEffect(() => {
  const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const handler = () => draw();
  mql.addEventListener('change', handler, { once: true });
  return () => mql.removeEventListener('change', handler);
}, [draw]);
```
The `once: true` pattern requires re-registering with the new DPI value on each trigger. A cleaner approach is a ref-based loop that always re-creates the media query after each change. This is a well-known pattern for DPI-aware canvas rendering. Without it, the plan's DPI support is incomplete for multi-monitor setups.

---

### 2. canvas.width/height vs style.width/height relationship

**Verdict: Correct.**

Setting `canvas.width = bufferWidth` (physical pixels) and `canvas.style.width = displayWidth + 'px'` (CSS pixels) is the standard technique for HiDPI canvas rendering. The browser maps `bufferWidth` backing-store pixels to `displayWidth` CSS pixels, achieving a 1:1 physical pixel ratio when `bufferWidth = displayWidth * dpr`.

The plan's implementation follows this correctly. One minor note: `Math.floor` on both dimensions means there can be a sub-pixel rounding discrepancy (at most 1 CSS pixel), but this is standard practice and acceptable.

---

### 3. ctx.drawImage(img, 0, 0, bufferWidth, bufferHeight) with pre-resized images

**Verdict: Correct, with a nuance worth noting.**

After Rust Lanczos3 pre-resize, the `<img>` element's `naturalWidth`/`naturalHeight` will approximately equal `target_height`-scaled dimensions. The canvas buffer is `displayWidth * dpr` by `displayHeight * dpr`. So `drawImage` performs a relatively small scale adjustment (roughly 1:1 if `target_height ~= innerHeight * dpr` and display fills the screen).

`drawImage` handles source-to-destination size mismatches correctly in all cases. When the source is slightly larger than the destination (cache was generated at a higher height), it downscales with `imageSmoothingQuality: 'high'` (bicubic). When slightly smaller, it upscales. Both cases are fine because the Lanczos3 pre-resize has already done the heavy lifting -- the remaining adjustment is minor.

**No issue here.** The combination of Rust Lanczos3 (large downscale) + Canvas bicubic (small final adjustment) is a sound two-stage approach.

---

### 4. flex: 1 in single/solo mode with maxWidth: 100%

**Verdict: Correct, no issue.**

In single/solo mode, CanvasPage gets `flex: 1` + `maxWidth: 100%`. The parent (SpreadView's wrapper div) also has `flex: 1`. Nested `flex: 1` items work correctly in CSS flexbox -- each expands to fill its flex container. With only one CanvasPage child and `maxWidth: 100%`, the CanvasPage container will take the full width of its parent, which is the intended behavior.

The `canvas` element inside has explicit `style.width` / `style.height` set by `draw()`, so it sizes independently of the flex container. The container provides the measurement surface (`clientWidth`/`clientHeight`), and the canvas is centered within it via `alignItems: center` + `justifyContent: center`.

**No issue.** The current behavior where `flex` was `undefined` in single mode actually caused the container to shrink-wrap to canvas content size, which is the root cause of the layout bug. The fix to always use `flex: 1` is correct.

---

### 5. Spread mode layout: two flex: 1 items with maxWidth: 50% in RTL

**Verdict: Correct.**

Two CanvasPage containers each with `flex: 1` + `maxWidth: 50%` inside a `direction: rtl` flex parent will:
- Each grow to fill available space (`flex: 1` distributes remaining space equally)
- Be capped at 50% width each (`maxWidth: 50%`)
- Be ordered right-to-left due to `direction: rtl`

With `gap: 0` on the parent (SpreadView), there is no space between the items. Two items at `flex: 1` + `maxWidth: 50%` will exactly fill 100% of the parent width with no gap.

The `direction: rtl` property on the parent div correctly reverses the visual order of flex items: the first child in DOM order (rightPage) appears on the right, and the second child (leftPage) appears on the left. This matches RTL manga reading order.

**No issue.** This is correct CSS for a gapless two-page spread.

---

### 6. ResizeObserver and DPI changes (multi-monitor)

**Verdict: Known limitation, same as point 1.**

ResizeObserver monitors the CSS content box size of the observed element. When DPI changes but the CSS pixel dimensions stay the same (which is typical when moving between monitors), ResizeObserver does NOT fire. This means the canvas buffer remains at the old physical resolution.

The design document does not address this gap. As noted in point 1, a `matchMedia` listener is needed to detect DPI changes and trigger a redraw.

**Impact:** On a dpr=1 monitor, the canvas buffer is `displayW * 1`. Moving to a dpr=2 monitor without a resize event means the buffer stays at `displayW * 1`, but should be `displayW * 2`. The image will appear blurry at 2x until the user navigates pages or resizes the window.

**Recommendation (Important):** Same as point 1. This is the single most significant gap in the frontend plan.

---

### 7. window.innerHeight * devicePixelRatio as target_height

**Verdict: Correct for the intended use case.**

`target_height = Math.floor(window.innerHeight * dpr)` produces the physical pixel height of the viewport. Since manga pages are height-constrained (fitted to viewport height with aspect ratio preserved), this is the correct target for Lanczos3 downscaling.

In spread mode, the viewport height is shared by both pages -- each page still needs to fit the full viewport height, just at half the width. Since `target_height` is height-based, spread mode does not affect it. A 1080p display at 150% scaling has `innerHeight ~= 720` CSS pixels and `dpr = 1.5`, so `target_height = 1080` -- which matches the physical pixel height exactly.

**No issue.** Height-based targeting is the right approach for manga/comic readers.

---

### 8. Cache coherency: cached at 1440, displayed at 1080

**Verdict: Acceptable with minor quality cost.**

When the cache contains a 1440-height image but the display only needs 1080 height:
- CanvasPage's `draw()` receives `naturalWidth`/`naturalHeight` from PageInfo (which reflects the cached 1440-height dimensions)
- The scale calculation `Math.min(containerW/naturalWidth, containerH/naturalHeight)` produces a scale < 1.0
- The canvas buffer is sized at `displaySize * dpr`, which is smaller than the cached image
- `drawImage` downscales the 1440-height image to fit the buffer using Canvas bicubic

This is a "cache larger than display" scenario. The visual result is acceptable -- bicubic downscaling of a slightly larger image is not problematic. There is a minor waste (larger file read from disk, slightly more memory for the Image element), but no visual degradation.

The opposite case (cache at 1080, display at 1440) is more concerning -- the canvas would upscale, losing quality. However, the design document notes this is handled by tolerating it or re-generating when the difference exceeds 20%. The plan itself does not implement the 20% re-generation logic (it is listed under "future considerations" in the design doc), so for now, cached images are always reused regardless of height mismatch.

**Recommendation (Suggestion):** Consider adding a comment in the code explaining that cache height mismatch is tolerated by design, and that the Lanczos3 pre-resize is a best-effort optimization rather than a pixel-perfect guarantee. This avoids confusion for future maintainers.

---

### 9. Tauri Option<u32> mapping from frontend

**Verdict: Correct.**

Tauri 2.x command argument deserialization uses serde. When the Rust parameter is `Option<u32>`:
- Passing `targetHeight: 1440` maps to `Some(1440)`
- Passing `targetHeight: undefined` or omitting the field maps to `None`
- Passing `targetHeight: null` also maps to `None`

The existing codebase confirms this pattern works: `folder_id: Option<String>` in `library.rs` and `drag_drop.rs` is already called from the frontend with optional values.

The `tauriInvoke` wrapper passes `args` as `Record<string, unknown>`, and Tauri's `invoke` serializes this to JSON. `undefined` values are stripped from JSON serialization, resulting in a missing field, which serde deserializes as `None` for `Option<T>`.

**No issue.** This is standard Tauri behavior.

---

### 10. naturalWidth/naturalHeight from Rust (resized) and draw() scale calculation

**Verdict: Correct, but requires careful understanding.**

After Rust Lanczos3 resize, PageInfo returns the resized dimensions (e.g., `width: 720, height: 1080` instead of original `width: 2400, height: 3600`). CanvasPage receives these as `naturalWidth`/`naturalHeight`.

The `draw()` function computes:
```
scaleX = containerW / naturalWidth    // e.g., 960 / 720 = 1.33
scaleY = containerH / naturalHeight   // e.g., 1080 / 1080 = 1.0
scale = Math.min(1.33, 1.0) = 1.0
displayWidth = 720 * 1.0 = 720
displayHeight = 1080 * 1.0 = 1080
```

The canvas displays at 720x1080 CSS pixels, which is correct -- the image fills the viewport height and is centered horizontally. The dpr multiplier then ensures the physical buffer matches.

However, there is a subtle issue: the `<img>` element loaded from the cache file has its own `naturalWidth`/`naturalHeight` (the actual image dimensions from the file), which may differ from the PageInfo dimensions if:
1. The cache was generated at a different `target_height` than the current PageInfo reports
2. The cache hit returns old PageInfo metadata (from `meta.json`) while the image was re-extracted at a different height

In the current plan, the `meta.json` stores the dimensions at extraction time, and `try_load_cache` returns those dimensions. On a cache hit, no re-extraction occurs, so the PageInfo dimensions match the actual cached file dimensions. This is consistent.

**No issue** for the normal flow. The only inconsistency scenario is if someone manually modifies cache files, which is not a realistic concern.

---

### 11. is_spread judgment after resize

**Verdict: Correct.**

`is_spread_page(width, height)` checks `width > height * 1.2`. The Rust `resize_page_data` function uses:
```rust
let scale = target_height as f64 / height as f64;
let target_width = (width as f64 * scale).round() as u32;
```

This preserves the aspect ratio. If the original image has `width/height = r`, then after resize:
- new_width = width * scale
- new_height = height * scale = target_height
- new_width / new_height = width / height = r (unchanged)

Therefore, `is_spread_page` returns the same result before and after resize, assuming the rounding in `target_width` does not cross the 1.2 threshold boundary. For typical manga dimensions (e.g., 1200x1800 portrait or 2400x1800 landscape), the rounding error is negligible.

However, the plan computes `is_spread` AFTER resize (line 231 of the plan: "get actual size after resize"), using `get_image_dimensions(&final_data)`. This means `is_spread` is based on the resized dimensions, which is correct since the aspect ratio is preserved.

**No issue.** Aspect ratio preservation guarantees consistent `is_spread` results.

---

## Additional Findings

### A. Missing useCallback dependency: draw() does not depend on dpr (Suggestion)

The proposed `draw()` function has `[naturalWidth, naturalHeight]` as its dependency array. Since `window.devicePixelRatio` is read inside the function body (not from a React state or prop), changes to DPI do not trigger a re-creation of the `draw` callback. This is intentional -- `draw` is called by ResizeObserver and effects, not by React re-renders.

However, this means `draw` is referentially stable across DPI changes, so the `useEffect` that calls `draw()` on mount/dependency change (line 113-115) will not re-fire when DPI changes. This reinforces the need for the `matchMedia` listener from point 1.

### B. Plan omission: canvas clearing before drawImage (Suggestion)

The plan's `draw()` does not call `ctx.clearRect()` before `drawImage`. When the canvas buffer dimensions change (which triggers `canvas.width = newWidth`), the canvas is automatically cleared. When dimensions stay the same but a new image is drawn, `drawImage` fully covers the canvas (destination is `0, 0, bufferWidth, bufferHeight`), so no stale pixels remain.

**No issue**, but adding a `clearRect` for robustness would cost nothing:
```typescript
ctx.clearRect(0, 0, bufferWidth, bufferHeight);
```

### C. resize_exact vs resize in Rust (Important)

The plan uses `img.resize_exact(target_width, target_height, FilterType::Lanczos3)`. The `image` crate's `resize_exact` does NOT preserve aspect ratio -- it stretches/squishes to the exact target dimensions. The plan pre-computes `target_width` from the aspect ratio, so the end result is correct. However, using `img.resize(target_width, target_height, FilterType::Lanczos3)` would be safer because `resize` preserves aspect ratio internally, fitting within the given bounding box.

With the manual aspect ratio calculation in `resize_page_data`, `resize_exact` works correctly. But if there is a rounding error in `target_width` (e.g., off by 1 pixel), `resize_exact` will introduce a subtle aspect ratio distortion. `resize` would avoid this.

**Recommendation:** Use `img.resize(target_width, target_height, FilterType::Lanczos3)` instead of `resize_exact` for robustness. The result will be identical in the normal case but safer against edge cases.

### D. Tauri command: synchronous prepare_pages blocks the main thread (Suggestion)

`prepare_pages` is a synchronous `#[tauri::command]`. With the added Lanczos3 resize, this command becomes significantly more CPU-intensive. Tauri 2 runs synchronous commands on a thread pool, not the main thread, so the UI will not freeze. However, the frontend `await` will block until all pages are resized.

This is acceptable for the current design (resize all pages upfront on cache miss). Future optimization could use `#[tauri::command(async)]` or stream pages incrementally, but this is out of scope.

### E. Cache invalidation on different target_height (Suggestion)

The plan does NOT implement any cache invalidation based on `target_height`. If the user first opens an archive on a 4K monitor (`target_height = 2160`) and then opens the same archive on a 1080p monitor (`target_height = 1080`), the cache hit returns the 2160-height images. This wastes memory and bandwidth but produces correct visual output (downscaled by Canvas).

The reverse case (cache at 1080, display at 2160) produces lower-quality output because the Canvas must upscale.

The design document mentions a future 20% threshold re-generation feature. For now, the plan's approach is a pragmatic trade-off. The review recommendation is to add a TODO comment in the code.

---

## Summary

| # | Point | Verdict | Severity |
|---|-------|---------|----------|
| 1 | dpr change detection | Gap -- ResizeObserver does not fire on DPI change | **Important** |
| 2 | canvas.width vs style.width | Correct | -- |
| 3 | drawImage with pre-resized images | Correct | -- |
| 4 | flex: 1 in single/solo mode | Correct | -- |
| 5 | Spread mode RTL layout | Correct | -- |
| 6 | ResizeObserver + DPI | Same as #1 | **Important** |
| 7 | innerHeight * dpr as target_height | Correct | -- |
| 8 | Cache height mismatch | Acceptable | Suggestion |
| 9 | Tauri Option<u32> mapping | Correct | -- |
| 10 | Resized naturalWidth in draw() | Correct | -- |
| 11 | is_spread after resize | Correct | -- |
| A | draw() dependency on dpr | By design, but reinforces #1 | Suggestion |
| B | clearRect before drawImage | Not needed but defensive | Suggestion |
| C | resize_exact vs resize | resize is safer | **Important** |
| D | Synchronous Tauri command | Acceptable | Suggestion |
| E | Cache invalidation | Not implemented, acceptable for now | Suggestion |

### Critical Issues: 0
### Important Issues: 2 (both actionable)

1. **Add matchMedia listener for DPI changes** -- Without this, multi-monitor DPI transitions leave the canvas at the wrong resolution until the next page navigation or window resize. This undermines the core goal of the DPI fix.

2. **Use `resize` instead of `resize_exact`** -- Safer against rounding errors in aspect ratio calculation. Drop-in replacement with identical behavior in the normal case.

### Conclusion

The frontend plan is **implementable and largely correct**. The Canvas DPI technique, flex layout fix, and Lanczos3 pre-resize integration are all sound. The two important issues above should be addressed in the implementation to fully deliver on the plan's goals. All other verification points pass without problems.
