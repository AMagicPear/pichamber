import { fileExtensions, fileNames } from "catppuccin-vsc-icons/src/defaults/fileIcons";
import { folderNames } from "catppuccin-vsc-icons/src/defaults/folderIcons";
// 全部 catppuccin-mocha 图标拼成的一个 sprite；`predev`/`prebuild` 钩子在
// dev/build 前调用 scripts/build-catppuccin-sprite.mjs 重新生成。
// 消费者用 `<svg><use :href="icon" /></svg>` 引用，浏览器对单个 sprite
// 文件一次拿全部，按 fragment 取出对应 symbol。
import spriteUrl from "@/assets/catppuccin-sprite.svg?url";

const PREFIX = "catppuccin-";
const fragment = (name: string) => `${spriteUrl}#${PREFIX}${name}`;

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
  if (fileNameIcon) return fragment(fileNameIcon);

  const extensionIcon = fileExtensionsByLength.find(([extension]) =>
    normalized.endsWith(`.${extension.toLowerCase()}`),
  )?.[1];
  return fragment(extensionIcon ?? "_file");
};

export const getEntryIcon = (name: string, isDirectory: boolean, expanded: boolean) => {
  if (!isDirectory) return getFileIcon(name);

  const folderIcon = folderNamesByLowerCase[name.toLowerCase()];
  if (folderIcon) return fragment(`${folderIcon}${expanded ? "_open" : ""}`);
  return fragment(expanded ? "_folder_open" : "_folder");
};
