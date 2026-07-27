import { fileExtensions, fileNames } from "catppuccin-vsc-icons/src/defaults/fileIcons";
import { folderNames } from "catppuccin-vsc-icons/src/defaults/folderIcons";

const iconUrl = (name: string) =>
  `https://raw.githubusercontent.com/catppuccin/vscode-icons/b6915da9f6889b683a110aa747de96c2820a537d/icons/mocha/${name}.svg`;

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
  if (fileNameIcon) return iconUrl(fileNameIcon);

  const extensionIcon = fileExtensionsByLength.find(([extension]) =>
    normalized.endsWith(`.${extension.toLowerCase()}`),
  )?.[1];
  return iconUrl(extensionIcon ?? "_file");
};

export const getEntryIcon = (name: string, isDirectory: boolean, expanded: boolean) => {
  if (!isDirectory) return getFileIcon(name);

  const folderIcon = folderNamesByLowerCase[name.toLowerCase()];
  if (folderIcon) return iconUrl(`${folderIcon}${expanded ? "_open" : ""}`);
  return iconUrl(expanded ? "_folder_open" : "_folder");
};
