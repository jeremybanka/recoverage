const Module = require("node:module")

const eslintTypeScript = require("typescript-eslint-typescript")
const load = Module._load

Module._load = function loadWithEslintTypeScript(request, parent, isMain) {
	if (request === "typescript") {
		return eslintTypeScript
	}

	if (request.startsWith("typescript/")) {
		return load.call(
			this,
			request.replace(/^typescript\//, "typescript-eslint-typescript/"),
			parent,
			isMain,
		)
	}

	return load.apply(this, arguments)
}
