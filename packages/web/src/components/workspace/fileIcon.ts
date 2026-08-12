import { fileExtensions, fileNames } from "catppuccin-vsc-icons/src/defaults/fileIcons";
import { folderNames } from "catppuccin-vsc-icons/src/defaults/folderIcons";

// Vite 在 build/dev 时把所有匹配的 SVG 静态 inline 成字符串。每个图标转成
// blob URL 缓存住，<img src=...> 跟之前一样用。零外网请求，颜色调色板硬编码
// 在 SVG 本身（mocha 用 #cdd6f4/#89b4fa 等），跟现有 Folders 同款；想换
// latte/frappe/macchiato 改下面 glob 路径。
const svgBlobs = import.meta.glob<string>(
  "../../../node_modules/catppuccin-vsc-icons/icons/mocha/*.svg",
  { eager: true, query: "?raw", import: "default" },
);
const iconUrls = new Map<string, string>();
for (const [path, raw] of Object.entries(svgBlobs)) {
  const name = path.slice(path.lastIndexOf("/") + 1, -".svg".length);
  iconUrls.set(name, URL.createObjectURL(new Blob([raw], { type: "image/svg+xml" })));
}
const resolveIcon = (name: string): string | undefined => iconUrls.get(name);

const fileNamesByLowerCase = Object.fromEntries(
  Object.entries(fileNames as Record<string, string>).map(([name, icon]) => [
    name.toLowerCase(),
    icon,
  ]),
);
const fileExtensionsByLength = Object.entries(fileExtensions as Record<string, string>).sort(
  ([a], [b]) => b.length - a.length,
);
const folderNamesByLowerCase = Object.fromEntries(
  Object.entries(folderNames as Record<string, string>).map(([name, icon]) => [
    name.toLowerCase(),
    icon,
  ]),
);

const getFileIcon = (name: string) => {
  const normalized = name.toLowerCase();
  const fileNameIcon = fileNamesByLowerCase[normalized];
  if (fileNameIcon) return resolveIcon(fileNameIcon);

  const extensionIcon = fileExtensionsByLength.find(([extension]) =>
    normalized.endsWith(`.${extension.toLowerCase()}`),
  )?.[1];
  return resolveIcon(extensionIcon ?? "_file") ?? "";
};

export const getEntryIcon = (name: string, isDirectory: boolean, expanded: boolean) => {
  if (!isDirectory) return getFileIcon(name);

  const folderIcon = folderNamesByLowerCase[name.toLowerCase()];
  if (folderIcon) return resolveIcon(`${folderIcon}${expanded ? "_open" : ""}`);
  return resolveIcon(expanded ? "_folder_open" : "_folder") ?? "";
};
