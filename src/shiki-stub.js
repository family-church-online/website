export const bundledThemes = {};
export const bundledLanguages = {};
export const bundledLanguagesInfo = [];
export const bundledThemesInfo = [];
export const createHighlighter = async () => ({
	codeToHtml: (c) => c,
	codeToHast: (c) => c,
	getLoadedLanguages: () => [],
	loadLanguage: async () => {},
	dispose: () => {},
});
export const getSingletonHighlighter = async () => ({
	codeToHtml: (c) => c,
	codeToHast: (c) => c,
	getLoadedLanguages: () => [],
	loadLanguage: async () => {},
	dispose: () => {},
});
export const createCssVariablesTheme = () => ({});
export const createOnigurumaEngine = () => ({});
export const isSpecialLang = () => false;
export const codeToHtml = (c) => c;
export const codeToHast = (c) => c;
export default {};
