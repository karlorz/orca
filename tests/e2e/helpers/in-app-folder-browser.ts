import { expect, type Page } from '@stablyai/playwright-test'

// Why: this fork browses Add project folders in-app on Linux instead of GTK showOpenDialog,
// so a native-dialog stub never runs there. Enter the path and select it in that browser.
export async function chooseFolderInAppBrowserIfShown(
  page: Page,
  folderPath: string
): Promise<void> {
  const browser = page.getByRole('dialog', { name: /Browse host filesystem/i })
  const shown = await browser
    .waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false)
  if (!shown) {
    return
  }
  const pathInput = browser.getByPlaceholder(/Type to filter or enter a path/i)
  const target = folderPath.endsWith('/') ? folderPath : `${folderPath}/`
  await expect
    .poll(
      async () => {
        if ((await browser.textContent())?.includes(`· ${folderPath}`)) {
          return true
        }
        await pathInput.fill(target)
        await pathInput.press('Enter')
        return false
      },
      { timeout: 15_000, message: `in-app folder browser did not open ${folderPath}` }
    )
    .toBe(true)
  await browser.getByRole('button', { name: 'Select folder', exact: true }).click()
}
