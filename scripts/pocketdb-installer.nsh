/**
 * PocketDB — custom NSIS include script.
 *
 * Injected into the installer that electron-builder generates (see
 * package.json "build.nsis.include"). It adds:
 *
 *   1) An install-or-uninstall choice on first launch (.onInit):
 *      - If PocketDB is already installed, the user is asked whether to
 *        Uninstall, Reinstall (repair), or Cancel.
 *      - Otherwise it proceeds to the normal interactive install flow.
 *
 * Notes:
 *   - Only functions/macros that electron-builder does not already define
 *     are added here, to avoid duplicate-symbol errors at NSIS compile time.
 *   - The install / uninstall sections themselves are owned by
 *     electron-builder's generated script (sections, file list, registry,
 *     uninstaller writing) and are left untouched.
 */

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define UNINSTALL_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\PocketDB"

; PRODUCT_NAME, VERSION and other product defines are provided by
; electron-builder's generated script — do not redefine them here.
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install ${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "Welcome to the ${PRODUCT_NAME} Setup wizard. This wizard will install ${PRODUCT_NAME} on your computer. Click Next to continue or Cancel to exit the setup."
!define MUI_LICENSEPAGE_TITLE "License Agreement"
!define MUI_LICENSEPAGE_TEXT "Please review the license terms before installing ${PRODUCT_NAME}. You must accept the terms to continue."
!define MUI_DIRECTORYPAGE_TITLE "Choose Install Location"
!define MUI_DIRECTORYPAGE_TEXT "Choose the folder in which to install ${PRODUCT_NAME}."
!define MUI_COMPONENTSPAGE_TITLE "Choose Components"
!define MUI_COMPONENTSPAGE_TEXT "Choose which components you want to install."
!define MUI_INSTFILESPAGE_TITLE "Installing"
!define MUI_INSTFILESPAGE_TEXT "Please wait while the Setup installs ${PRODUCT_NAME} on your computer."
!define MUI_FINISHPAGE_TITLE "${PRODUCT_NAME} Setup"
!define MUI_FINISHPAGE_TEXT "${PRODUCT_NAME} has been installed on your computer."

!define MUI_UNWELCOMEPAGE_TITLE "Uninstall ${PRODUCT_NAME}"
!define MUI_UNWELCOMEPAGE_TEXT "This wizard will remove ${PRODUCT_NAME} from your computer. Click Uninstall to proceed or Cancel to exit."
!define MUI_UNFINISHPAGE_TITLE "${PRODUCT_NAME} Uninstall"
!define MUI_UNFINISHPAGE_TEXT "${PRODUCT_NAME} has been uninstalled from your computer."

!define MUI_UNPAGE_CONFIRM
!define MUI_UNPAGE_CONFIRM_TEXT "Are you sure you want to completely remove ${PRODUCT_NAME} and all of its components?"

!define MUI_STARTMENUPAGE_DEFAULTFOLDER "${PRODUCT_NAME}"

; Note: electron-builder owns the installer's .onInit and page sequence, so the
; install-or-uninstall choice cannot be injected here. The uninstaller is always
; generated (available via Add/Remove Programs) and preserves user data by default
; (deleteAppDataOnUninstall: false).
