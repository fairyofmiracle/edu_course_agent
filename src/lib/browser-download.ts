export const DOWNLOAD_NEEDS_STUDIO =
  "Файл собран на сервере. Скачайте его кнопкой «Выгрузить» в студии.";

export function triggerBrowserDownload(filename: string, blob: Blob) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error(DOWNLOAD_NEEDS_STUDIO);
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string, type: string) {
  triggerBrowserDownload(filename, new Blob([content], { type }));
}
