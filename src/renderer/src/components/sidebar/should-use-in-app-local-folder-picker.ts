export function shouldUseInAppLocalFolderPicker(platform?: NodeJS.Platform): boolean {
  // Why: Electron's GTK file chooser aborts the whole app on some Linux displays
  // (Xvfb / missing xdg-desktop-portal). In-app listing is the same authority
  // as SSH/runtime Browse host and does not load gtk-open.
  const resolvedPlatform =
    platform ?? (typeof window === 'undefined' ? undefined : window.api?.platform?.get()?.platform)
  return resolvedPlatform === 'linux'
}
