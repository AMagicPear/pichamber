import { defineComponent } from "vue";

/** 图标在原始坐标下的包围盒，独立使用时建议作为 svg 的 viewBox。 */
export const LOGO_MARK_VIEW_BOX = "165.29 165.29 469.43 469.43";

/** Pichamber 的图标标记：AppLogo 顶面里的那块图标，由一个 `<g>` 承载，
 *  不自己持有 viewBox / transform —— 坐标系统交给调用方：
 *   - 独立使用时放在 `<svg viewBox={LOGO_MARK_VIEW_BOX}>` 里，不贴面、不变换；
 *   - AppLogo 内放进已有的 `isoMatrix scale(0.06) translate(-400,-400)` 变换下，视觉不变。 */
export const LogoMark = defineComponent({
  name: "LogoMark",
  props: {
    className: { type: String, default: "" },
    color: { type: String, default: "currentColor" },
  },
  setup(props) {
    return () => (
      <g class={props.className}>
        <path
          fill-rule="evenodd"
          clip-rule="evenodd"
          d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
          fill={props.color}
        />
        <path d="M517.36 400H634.72V634.72H517.36Z" fill={props.color} fill-opacity="0.4" />
      </g>
    );
  },
});

export default LogoMark;
