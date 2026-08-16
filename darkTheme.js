const themeToggleSelector = 'button[aria-label="Toggle theme"]';
const themeTimeout = 15000;

function themeError(message) {
  const error = new Error("DARK_THEME_UNAVAILABLE: " + message);
  error.code = "DARK_THEME_UNAVAILABLE";
  return error;
}

async function getThemeState(page) {
  return page.$$eval(themeToggleSelector, (buttons) => {
    if (buttons.length !== 1) {
      return "invalid";
    }

    const button = buttons[0];
    const darkIconCount = button.querySelectorAll(".icon-dark").length;
    const lightIconCount = button.querySelectorAll(".icon-light").length;

    if (button.disabled) {
      return "disabled";
    }

    if (darkIconCount === 1 && lightIconCount === 0) {
      return "light";
    }

    if (darkIconCount === 0 && lightIconCount === 1) {
      return "dark";
    }

    return "unknown";
  });
}

async function ensureDarkTheme(page) {
  try {
    await page.waitForSelector(themeToggleSelector, {
      visible: true,
      timeout: themeTimeout,
    });
  } catch (err) {
    throw themeError("Toggle theme button not found");
  }

  const themeState = await getThemeState(page);

  if (themeState === "dark") {
    return;
  }

  if (themeState !== "light") {
    throw themeError("Toggle theme button has " + themeState + " state");
  }

  try {
    await page.click(themeToggleSelector);
    await page.waitForFunction(
      (selector) => {
        const buttons = document.querySelectorAll(selector);

        if (buttons.length !== 1 || buttons[0].disabled) {
          return false;
        }

        const button = buttons[0];
        return (
          button.querySelectorAll(".icon-dark").length === 0 &&
          button.querySelectorAll(".icon-light").length === 1
        );
      },
      { timeout: themeTimeout },
      themeToggleSelector
    );
  } catch (err) {
    throw themeError("Toggle theme button did not switch to dark mode");
  }
}

module.exports = { ensureDarkTheme };
