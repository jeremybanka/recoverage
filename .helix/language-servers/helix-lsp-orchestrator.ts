#!/usr/bin/env bun

import { spawn } from "node:child_process"
import { resolve } from "node:path"

type JsonRpcMessage = {
	id?: number | string
	method?: string
	params?: unknown
	result?: unknown
	error?: unknown
	jsonrpc: `2.0`
}

type TextDocumentIdentifier = {
	uri: string
	version?: number
}

type TextDocument = TextDocumentIdentifier & {
	text: string
}

type Position = {
	character: number
	line: number
}

type Range = {
	end: Position
	start: Position
}

type TextEdit = {
	newText: string
	range: Range
}

type DiagnosticReport = {
	items?: Diagnostic[]
	kind?: string
}

type Diagnostic = {
	range: Range
	[key: string]: unknown
}

type CodeAction = {
	edit?: {
		changes?: Record<string, unknown[]>
		documentChanges?: {
			edits?: unknown[]
			textDocument?: TextDocumentIdentifier
		}[]
	}
}

const projectRoot = resolve(import.meta.dirname, `..`, `..`)

const server = spawn(
	`/opt/homebrew/bin/node`,
	[`./node_modules/.bin/vscode-eslint-language-server`, `--stdio`],
	{
		cwd: projectRoot,
		stdio: [`pipe`, `pipe`, `pipe`],
	},
)
const biomeServer = spawn(`./node_modules/.bin/biome`, [`lsp-proxy`], {
	cwd: projectRoot,
	stdio: [`pipe`, `pipe`, `pipe`],
})

const openDocuments = new Map<string, TextDocumentIdentifier>()
const documentTexts = new Map<string, string>()
const diagnosticsByUri = new Map<string, Diagnostic[]>()
const pendingRefreshes = new Map<string, ReturnType<typeof setTimeout>>()
const diagnosticRequests = new Map<number | string, TextDocumentIdentifier>()
const serverRequests = new Map<
	number | string,
	{
		timeout: ReturnType<typeof setTimeout>
		reject: (error: unknown) => void
		resolve: (result: unknown) => void
	}
>()
const biomeRequests = new Map<
	number | string,
	{
		timeout: ReturnType<typeof setTimeout>
		reject: (error: unknown) => void
		resolve: (result: unknown) => void
	}
>()
let nextDiagnosticRequestId = 1
let nextServerRequestId = 1
let nextBiomeRequestId = 1

const biomeReady = initializeBiome()

process.on(`SIGINT`, shutdown)
process.on(`SIGTERM`, shutdown)
process.on(`exit`, () => {
	server.kill()
	biomeServer.kill()
})

server.stderr.on(`data`, (chunk) => {
	process.stderr.write(chunk)
})
biomeServer.stderr.on(`data`, (chunk) => {
	process.stderr.write(chunk)
})

server.on(`exit`, (code, signal) => {
	for (const timeout of pendingRefreshes.values()) {
		clearTimeout(timeout)
	}

	if (signal) {
		process.exit(1)
	}

	process.exit(code ?? 1)
})
biomeServer.on(`exit`, (code, signal) => {
	if (signal) {
		process.exit(1)
	}

	process.exit(code ?? 1)
})

function shutdown() {
	server.kill()
	biomeServer.kill()
	process.exit(0)
}

readMessages(process.stdin, (message) => {
	void handleClientMessage(message).then((handled) => {
		if (!handled) {
			writeMessage(server.stdin, message)
		}
	})
})

readMessages(server.stdout, (message) => {
	if (handleServerMessage(message)) {
		return
	}

	writeMessage(process.stdout, message)
})
readMessages(biomeServer.stdout, handleBiomeMessage)

async function handleClientMessage(message: JsonRpcMessage) {
	if (message.method === `textDocument/didOpen`) {
		const textDocument = getTextDocument(message.params)
		if (textDocument) {
			openDocuments.set(textDocument.uri, textDocument)
			const text = getOpenedText(message.params)
			if (text !== undefined) {
				documentTexts.set(textDocument.uri, text)
			}
			void biomeReady.then(() => {
				writeMessage(biomeServer.stdin, message)
			})
			scheduleDiagnosticRefresh(textDocument)
		}
	} else if (message.method === `textDocument/didChange`) {
		const textDocument = getTextDocument(message.params)
		if (textDocument) {
			openDocuments.set(textDocument.uri, {
				...openDocuments.get(textDocument.uri),
				...textDocument,
			})
			updateDocumentText(textDocument.uri, message.params)
			void biomeReady.then(() => {
				writeMessage(biomeServer.stdin, message)
			})
			scheduleDiagnosticRefresh(textDocument)
		}
	} else if (message.method === `textDocument/didSave`) {
		const textDocument = getTextDocument(message.params)
		if (textDocument) {
			scheduleDiagnosticRefresh(
				openDocuments.get(textDocument.uri) ?? textDocument,
			)
		}
	} else if (message.method === `textDocument/didClose`) {
		const textDocument = getTextDocument(message.params)
		if (textDocument) {
			openDocuments.delete(textDocument.uri)
			documentTexts.delete(textDocument.uri)
			diagnosticsByUri.delete(textDocument.uri)
			void biomeReady.then(() => {
				writeMessage(biomeServer.stdin, message)
			})
			clearDiagnosticRefresh(textDocument.uri)
			publishDiagnostics(textDocument, [])
		}
	} else if (message.method === `textDocument/codeAction`) {
		const textDocument = getTextDocument(message.params)
		if (message.id === undefined || !textDocument) {
			return false
		}

		const actions = await getCodeActions(textDocument, message.params)
		writeMessage(process.stdout, {
			jsonrpc: `2.0`,
			id: message.id,
			result: actions,
		})
		return true
	} else if (message.method === `textDocument/formatting`) {
		const textDocument = getTextDocument(message.params)
		if (message.id === undefined || !textDocument) {
			return false
		}

		const edits = await formatWithBiomeThenFixWithEslint(textDocument)
		writeMessage(process.stdout, {
			jsonrpc: `2.0`,
			id: message.id,
			result: edits,
		})
		return true
	} else if (message.method === `textDocument/willSaveWaitUntil`) {
		const textDocument = getTextDocument(message.params)
		if (message.id === undefined || !textDocument) {
			return false
		}

		const edits = await fixAll(textDocument)
		writeMessage(process.stdout, {
			jsonrpc: `2.0`,
			id: message.id,
			result: edits,
		})
		return true
	}

	return false
}

function handleServerMessage(message: JsonRpcMessage) {
	if (message.id !== undefined && serverRequests.has(message.id)) {
		const request = serverRequests.get(message.id)
		serverRequests.delete(message.id)
		if (request) {
			clearTimeout(request.timeout)
		}

		if (message.error) {
			request?.reject(message.error)
		} else {
			request?.resolve(message.result)
		}

		return true
	}

	if (isInitializeResult(message)) {
		message.result.capabilities.textDocumentSync.willSaveWaitUntil = true
		message.result.capabilities.codeActionProvider = {
			codeActionKinds: [`quickfix`, `source.fixAll.eslint`, `source.fixAll`],
			resolveProvider: false,
		}
		message.result.capabilities.documentFormattingProvider = true
		return false
	}

	if (message.id === undefined || !diagnosticRequests.has(message.id)) {
		return false
	}

	const textDocument = diagnosticRequests.get(message.id)
	diagnosticRequests.delete(message.id)

	if (!textDocument || message.error) {
		return true
	}

	const report = message.result as DiagnosticReport
	publishDiagnostics(textDocument, report.items ?? [])
	return true
}

function handleBiomeMessage(message: JsonRpcMessage) {
	if (message.id !== undefined && biomeRequests.has(message.id)) {
		const request = biomeRequests.get(message.id)
		biomeRequests.delete(message.id)
		if (request) {
			clearTimeout(request.timeout)
		}

		if (message.error) {
			request?.reject(message.error)
		} else {
			request?.resolve(message.result)
		}

		return
	}

	if (message.method && message.id !== undefined) {
		writeMessage(biomeServer.stdin, {
			jsonrpc: `2.0`,
			id: message.id,
			result: getBiomeServerRequestResult(message),
		})
	}
}

async function fixAll(textDocument: TextDocumentIdentifier) {
	try {
		const diagnostics = await getDiagnostics(textDocument)
		publishDiagnostics(textDocument, diagnostics)

		return await getFixAllEdits(textDocument, diagnostics)
	} catch (error) {
		console.error(`Failed to apply ESLint fixes on save:`, error)
		return []
	}
}

async function getFixAllEdits(
	textDocument: TextDocumentIdentifier,
	diagnostics: unknown[] = [],
) {
	const actions = (await sendServerRequest(`textDocument/codeAction`, {
		textDocument: { uri: textDocument.uri },
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 },
		},
		context: {
			diagnostics,
			only: [`source.fixAll.eslint`],
			triggerKind: 1,
		},
	})) as CodeAction[]

	return getTextEdits(textDocument.uri, actions[0]) as TextEdit[]
}

async function getCodeActions(
	textDocument: TextDocumentIdentifier,
	params: unknown,
) {
	const codeActionParams = enrichCodeActionParams(textDocument.uri, params)
	return await sendServerRequest(`textDocument/codeAction`, codeActionParams)
}

async function getEslintFormattingEdits(textDocument: TextDocumentIdentifier) {
	return (await sendServerRequest(`textDocument/formatting`, {
		textDocument: { uri: textDocument.uri },
		options: {
			insertSpaces: false,
			tabSize: 2,
		},
	})) as TextEdit[]
}

async function formatWithBiomeThenFixWithEslint(
	textDocument: TextDocumentIdentifier,
) {
	const originalText = documentTexts.get(textDocument.uri)
	if (originalText === undefined) {
		return []
	}

	const biomeEdits = await getBiomeFormattingEdits(textDocument)
	const formattedText = applyTextEdits(originalText, biomeEdits) ?? originalText

	const formattedDocument = {
		...textDocument,
		version: (textDocument.version ?? 0) + 1,
	}
	syncServerDocumentText(formattedDocument, formattedText)

	let fixEdits: TextEdit[] = []
	if (shouldRunEslint(textDocument.uri)) {
		try {
			fixEdits = await getEslintFormattingEdits(formattedDocument)
		} catch (error) {
			console.error(`Failed to apply ESLint fixes while formatting:`, error)
		}
	}

	const fixedText = applyTextEdits(formattedText, fixEdits)
	const finalText = fixedText ?? formattedText

	if (finalText === originalText) {
		return []
	}

	documentTexts.set(textDocument.uri, finalText)
	return [
		{
			newText: finalText,
			range: fullDocumentRange(originalText),
		},
	]
}

function shouldRunEslint(uri: string) {
	return /\.[cm]?[jt]sx?$/u.test(uri)
}

function syncServerDocumentText(
	textDocument: TextDocumentIdentifier,
	text: string,
) {
	writeMessage(server.stdin, {
		jsonrpc: `2.0`,
		method: `textDocument/didChange`,
		params: {
			textDocument,
			contentChanges: [{ text }],
		},
	})
}

async function getBiomeFormattingEdits(textDocument: TextDocumentIdentifier) {
	await biomeReady
	return (await sendBiomeRequest(`textDocument/formatting`, {
		textDocument: { uri: textDocument.uri },
		options: {
			insertSpaces: false,
			tabSize: 2,
		},
	})) as TextEdit[]
}

function scheduleDiagnosticRefresh(textDocument: TextDocumentIdentifier) {
	clearDiagnosticRefresh(textDocument.uri)

	pendingRefreshes.set(
		textDocument.uri,
		setTimeout(() => {
			pendingRefreshes.delete(textDocument.uri)
			requestDiagnostics(openDocuments.get(textDocument.uri) ?? textDocument)
		}, 200),
	)
}

function clearDiagnosticRefresh(uri: string) {
	const timeout = pendingRefreshes.get(uri)
	if (!timeout) {
		return
	}

	clearTimeout(timeout)
	pendingRefreshes.delete(uri)
}

function requestDiagnostics(textDocument: TextDocumentIdentifier) {
	const id = `eslint-pull-diagnostics-${nextDiagnosticRequestId++}`
	diagnosticRequests.set(id, textDocument)

	writeMessage(server.stdin, {
		jsonrpc: `2.0`,
		id,
		method: `textDocument/diagnostic`,
		params: {
			textDocument: { uri: textDocument.uri },
			previousResultId: null,
		},
	})
}

async function getDiagnostics(textDocument: TextDocumentIdentifier) {
	const report = (await sendServerRequest(`textDocument/diagnostic`, {
		textDocument: { uri: textDocument.uri },
		previousResultId: null,
	})) as DiagnosticReport

	return report.items ?? []
}

function sendServerRequest(method: string, params: unknown) {
	const id = `eslint-proxy-${nextServerRequestId++}`

	writeMessage(server.stdin, {
		jsonrpc: `2.0`,
		id,
		method,
		params,
	})

	return new Promise((complete, reject) => {
		const timeout = setTimeout(() => {
			serverRequests.delete(id)
			reject(new Error(`Timed out waiting for ESLint response to ${method}.`))
		}, 10000)
		serverRequests.set(id, { reject, resolve: complete, timeout })
	})
}

function sendBiomeRequest(method: string, params: unknown) {
	const id = `biome-proxy-${nextBiomeRequestId++}`

	writeMessage(biomeServer.stdin, {
		jsonrpc: `2.0`,
		id,
		method,
		params,
	})

	return new Promise((complete, reject) => {
		const timeout = setTimeout(() => {
			biomeRequests.delete(id)
			reject(new Error(`Timed out waiting for Biome response to ${method}.`))
		}, 2000)
		biomeRequests.set(id, { reject, resolve: complete, timeout })
	})
}

async function initializeBiome() {
	await sendBiomeRequest(`initialize`, {
		processId: null,
		rootUri: `file://${projectRoot}`,
		capabilities: {
			workspace: {
				configuration: true,
				didChangeWatchedFiles: { dynamicRegistration: true },
			},
			textDocument: {
				codeAction: { dynamicRegistration: true },
				diagnostic: { dynamicRegistration: true },
				formatting: { dynamicRegistration: true },
				onTypeFormatting: { dynamicRegistration: true },
				rangeFormatting: { dynamicRegistration: true },
				synchronization: { dynamicRegistration: true },
			},
		},
		workspaceFolders: [{ uri: `file://${projectRoot}`, name: `recoverage` }],
	})
	writeMessage(biomeServer.stdin, {
		jsonrpc: `2.0`,
		method: `initialized`,
		params: {},
	})
}

function getBiomeServerRequestResult(message: JsonRpcMessage) {
	if (message.method === `workspace/configuration`) {
		const items = (message.params as { items?: unknown[] } | undefined)?.items
		return Array.isArray(items) ? items.map(() => ({})) : []
	}

	return null
}

function publishDiagnostics(
	textDocument: TextDocumentIdentifier,
	diagnostics: Diagnostic[],
) {
	diagnosticsByUri.set(textDocument.uri, diagnostics)
	writeMessage(process.stdout, {
		jsonrpc: `2.0`,
		method: `textDocument/publishDiagnostics`,
		params: {
			uri: textDocument.uri,
			version: textDocument.version,
			diagnostics,
		},
	})
}

function enrichCodeActionParams(uri: string, params: unknown) {
	if (!params || typeof params !== `object`) {
		return params
	}

	const nextParams = structuredClone(params) as {
		context?: { diagnostics?: Diagnostic[] }
		range?: Range
	}
	const diagnostics = nextParams.context?.diagnostics
	if (diagnostics && diagnostics.length > 0) {
		return nextParams
	}

	const matchingDiagnostics = diagnosticsByUri.get(uri)?.filter((diagnostic) => {
		return nextParams.range
			? rangesOverlap(diagnostic.range, nextParams.range)
			: true
	})

	if (!matchingDiagnostics?.length) {
		return nextParams
	}

	nextParams.context ??= {}
	nextParams.context.diagnostics = matchingDiagnostics
	return nextParams
}

function rangesOverlap(left: Range, right: Range) {
	return (
		comparePositions(left.start, right.end) <= 0 &&
		comparePositions(right.start, left.end) <= 0
	)
}

function comparePositions(left: Position, right: Position) {
	if (left.line !== right.line) {
		return left.line - right.line
	}

	return left.character - right.character
}

function getOpenedText(params: unknown) {
	if (!params || typeof params !== `object`) {
		return undefined
	}

	const textDocument = (params as { textDocument?: unknown }).textDocument
	if (!textDocument || typeof textDocument !== `object`) {
		return undefined
	}

	const { text } = textDocument as TextDocument
	return typeof text === `string` ? text : undefined
}

function updateDocumentText(uri: string, params: unknown) {
	if (!params || typeof params !== `object`) {
		return
	}

	const changes = (params as { contentChanges?: unknown }).contentChanges
	if (!Array.isArray(changes)) {
		return
	}

	let text = documentTexts.get(uri)
	if (text === undefined) {
		return
	}

	for (const change of changes) {
		if (!change || typeof change !== `object`) {
			continue
		}

		const { range, text: nextText } = change as {
			range?: Range
			text?: unknown
		}
		if (typeof nextText !== `string`) {
			continue
		}

		text = range ? applyTextEdit(text, { range, newText: nextText }) : nextText
	}

	documentTexts.set(uri, text)
}

function getTextDocument(params: unknown): TextDocumentIdentifier | undefined {
	if (!params || typeof params !== `object`) {
		return undefined
	}

	const textDocument = (params as { textDocument?: unknown }).textDocument
	if (!textDocument || typeof textDocument !== `object`) {
		return undefined
	}

	const { uri, version } = textDocument as TextDocumentIdentifier
	if (typeof uri !== `string`) {
		return undefined
	}

	return {
		uri,
		version: typeof version === `number` ? version : undefined,
	}
}

function getTextEdits(uri: string, action?: CodeAction) {
	if (!action?.edit) {
		return []
	}

	const changes = action.edit.changes?.[uri]
	if (changes) {
		return changes
	}

	const documentChange = action.edit.documentChanges?.find(
		(change) => change.textDocument?.uri === uri,
	)
	return documentChange?.edits ?? []
}

function applyTextEdits(text: string, edits: TextEdit[]) {
	if (!Array.isArray(edits)) {
		return undefined
	}

	return edits
		.toSorted((left, right) => {
			return (
				positionToOffset(text, right.range.start) -
				positionToOffset(text, left.range.start)
			)
		})
		.reduce((nextText, edit) => applyTextEdit(nextText, edit), text)
}

function applyTextEdit(text: string, edit: TextEdit) {
	const start = positionToOffset(text, edit.range.start)
	const end = positionToOffset(text, edit.range.end)
	return `${text.slice(0, start)}${edit.newText}${text.slice(end)}`
}

function fullDocumentRange(text: string): Range {
	const lines = text.split(`\n`)
	const lastLine = lines.at(-1) ?? ``
	return {
		start: { line: 0, character: 0 },
		end: {
			line: lines.length - 1,
			character: stringLengthUtf16(lastLine),
		},
	}
}

function positionToOffset(text: string, position: Position) {
	const lines = text.split(`\n`)
	let offset = 0

	for (let lineIndex = 0; lineIndex < position.line; lineIndex++) {
		offset += (lines[lineIndex]?.length ?? 0) + 1
	}

	return (
		offset +
		utf16OffsetToStringOffset(lines[position.line] ?? ``, position.character)
	)
}

function utf16OffsetToStringOffset(text: string, character: number) {
	let utf16Length = 0
	let offset = 0

	for (const char of text) {
		if (utf16Length >= character) {
			break
		}

		utf16Length += stringLengthUtf16(char)
		offset += char.length
	}

	return offset
}

function stringLengthUtf16(text: string) {
	return [...text].reduce((length, char) => length + char.length, 0)
}

function isInitializeResult(
	message: JsonRpcMessage,
): message is JsonRpcMessage & {
	result: {
		capabilities: {
			documentFormattingProvider?: boolean
			textDocumentSync: { willSaveWaitUntil?: boolean }
		}
	}
} {
	if (!message.result || typeof message.result !== `object`) {
		return false
	}

	const capabilities = (message.result as { capabilities?: unknown })
		.capabilities
	if (!capabilities || typeof capabilities !== `object`) {
		return false
	}

	const textDocumentSync = (capabilities as { textDocumentSync?: unknown })
		.textDocumentSync
	return !!textDocumentSync && typeof textDocumentSync === `object`
}

function readMessages(
	stream: NodeJS.ReadableStream,
	onMessage: (message: JsonRpcMessage) => void,
) {
	let buffer = Buffer.alloc(0)

	stream.on(`data`, (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk])

		while (true) {
			const headerEnd = buffer.indexOf(`\r\n\r\n`)
			if (headerEnd === -1) {
				return
			}

			const header = buffer.subarray(0, headerEnd).toString()
			const contentLength = Number(/^Content-Length: (\d+)$/im.exec(header)?.[1])
			const bodyStart = headerEnd + 4

			if (
				!Number.isFinite(contentLength) ||
				buffer.length < bodyStart + contentLength
			) {
				return
			}

			const body = buffer
				.subarray(bodyStart, bodyStart + contentLength)
				.toString()
			buffer = buffer.subarray(bodyStart + contentLength)
			onMessage(JSON.parse(body) as JsonRpcMessage)
		}
	})
}

function writeMessage(stream: NodeJS.WritableStream, message: JsonRpcMessage) {
	const body = Buffer.from(JSON.stringify(message))
	stream.write(`Content-Length: ${body.length}\r\n\r\n`)
	stream.write(body)
}
