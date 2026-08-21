import { defineComponent, type PropType } from "vue";

const LEFT_FACE_CELL_OPACITIES = [
  0.2, 0.45, 0.15, 0.55,
  0.35, 0.1, 0.5, 0.25,
  0.4, 0.3, 0.45, 0.15,
  0.55, 0.2, 0.35, 0.1,
];

const RIGHT_FACE_CELL_OPACITIES = [
  0.3, 0.15, 0.45, 0.25,
  0.5, 0.35, 0.1, 0.4,
  0.2, 0.55, 0.3, 0.15,
  0.45, 0.25, 0.4, 0.2,
];

type Point = { x: number; y: number };

type FaceCell = {
  path: string;
  row: number;
  col: number;
};

const generateFaceGrid = (
  topLeft: Point,
  topRight: Point,
  bottomRight: Point,
  bottomLeft: Point,
  gridSize = 4,
): FaceCell[] => {
  const cells: FaceCell[] = [];
  const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
  const bilinear = (
    tl: number,
    tr: number,
    br: number,
    bl: number,
    horizontal: number,
    vertical: number,
  ) => lerp(lerp(tl, tr, horizontal), lerp(bl, br, horizontal), vertical);

  for (let row = 0; row < gridSize; row += 1) {
    for (let col = 0; col < gridSize; col += 1) {
      const left = col / gridSize;
      const right = (col + 1) / gridSize;
      const top = row / gridSize;
      const bottom = (row + 1) / gridSize;
      const point = (horizontal: number, vertical: number): Point => ({
        x: bilinear(topLeft.x, topRight.x, bottomRight.x, bottomLeft.x, horizontal, vertical),
        y: bilinear(topLeft.y, topRight.y, bottomRight.y, bottomLeft.y, horizontal, vertical),
      });
      const p1 = point(left, top);
      const p2 = point(right, top);
      const p3 = point(right, bottom);
      const p4 = point(left, bottom);

      cells.push({
        path: `M${p1.x} ${p1.y} L${p2.x} ${p2.y} L${p3.x} ${p3.y} L${p4.x} ${p4.y} Z`,
        row,
        col,
      });
    }
  }

  return cells;
};

const edge = 48;
const cos30 = 0.866;
const sin30 = 0.5;
const centerY = 50;
const top = { x: 50, y: centerY - edge };
const left = { x: 50 - edge * cos30, y: centerY - edge * sin30 };
const right = { x: 50 + edge * cos30, y: centerY - edge * sin30 };
const center = { x: 50, y: centerY };
const bottomLeft = { x: 50 - edge * cos30, y: centerY + edge * sin30 };
const bottomRight = { x: 50 + edge * cos30, y: centerY + edge * sin30 };
const bottom = { x: 50, y: centerY + edge };
const topFaceCenterY = (top.y + left.y + center.y + right.y) / 4;
const isoMatrix = `matrix(0.866, 0.5, -0.866, 0.5, 50, ${topFaceCenterY})`;
const leftFaceCells = generateFaceGrid(left, center, bottom, bottomLeft);
const rightFaceCells = generateFaceGrid(center, right, bottomRight, bottom);

/**
 * Pichamber's application logo, migrated from OpenChamberLogo.tsx.
 * It intentionally has no placement in the current application shell.
 */
export const AppLogo = defineComponent({
  name: "AppLogo",
  props: {
    className: { type: String, default: "" },
    width: { type: Number, default: 70 },
    height: { type: Number, default: 70 },
    isAnimated: { type: Boolean, default: false },
    ariaLabel: { type: String, default: "Pichamber logo" },
    strokeColor: { type: String, default: "currentColor" },
    fillColor: { type: String, default: "color-mix(in srgb, currentColor 15%, transparent)" },
    cellHighlightColor: {
      type: String as PropType<string>,
      default: "color-mix(in srgb, currentColor 35%, transparent)",
    },
  },
  setup(props) {
    return () => (
      <svg
        width={props.width}
        height={props.height}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class={props.className}
        role="img"
        aria-label={props.ariaLabel}
      >
        {props.isAnimated ? (
          <style>{`@keyframes app-logo-glow{0%,100%{filter:drop-shadow(0 0 0 transparent)}50%{filter:drop-shadow(0 0 4px currentColor)}}.app-logo-glow{animation:app-logo-glow 1.8s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.app-logo-glow{animation:none}}`}</style>
        ) : null}
        <path
          d={`M${center.x} ${center.y} L${left.x} ${left.y} L${bottomLeft.x} ${bottomLeft.y} L${bottom.x} ${bottom.y} Z`}
          fill={props.fillColor}
          stroke={props.strokeColor}
          stroke-width="2"
          stroke-linejoin="round"
        />
        {leftFaceCells.map((cell, index) => (
          <path
            key={`left-${index}`}
            d={cell.path}
            fill={props.cellHighlightColor}
            opacity={LEFT_FACE_CELL_OPACITIES[cell.row * 4 + (3 - cell.col)] ?? 0.35}
          />
        ))}
        <path
          d={`M${center.x} ${center.y} L${right.x} ${right.y} L${bottomRight.x} ${bottomRight.y} L${bottom.x} ${bottom.y} Z`}
          fill={props.fillColor}
          stroke={props.strokeColor}
          stroke-width="2"
          stroke-linejoin="round"
        />
        {rightFaceCells.map((cell, index) => (
          <path
            key={`right-${index}`}
            d={cell.path}
            fill={props.cellHighlightColor}
            opacity={RIGHT_FACE_CELL_OPACITIES[cell.row * 4 + cell.col] ?? 0.35}
          />
        ))}
        <path
          d={`M${top.x} ${top.y} L${left.x} ${left.y} L${center.x} ${center.y} L${right.x} ${right.y} Z`}
          fill="none"
          stroke={props.strokeColor}
          stroke-width="2"
          stroke-linejoin="round"
        />
        <g class={props.isAnimated ? "app-logo-glow" : undefined}>
          <g transform={`${isoMatrix} scale(0.06) translate(-400, -400)`}>
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
              fill={props.strokeColor}
            />
            <path
              d="M517.36 400H634.72V634.72H517.36Z"
              fill={props.strokeColor}
              fill-opacity="0.4"
            />
          </g>
        </g>
      </svg>
    );
  },
});

export default AppLogo;
