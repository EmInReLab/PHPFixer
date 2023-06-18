import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { promises as fs } from 'fs';
import axios, { AxiosResponse } from 'axios';


// const patchList = [
// 	'return $str1;',
// 	'return $str2;',
// 	'',
// 	'return $str1 . $str2;',
// 	'return $str1 . $str2 . $str1 . $str2;',
// 	'return $str1 . $str2;',
// 	'return $str2;',
// ]

async function modifyFileWithPatch(filePath: string, startLine: number, endLine: number, patch: string):Promise<void> {
	try {
		const data = await fs.readFile(filePath, 'utf8');
		const lines = data.split('\n');
	
		if (startLine <= 0 || endLine > lines.length || startLine > endLine) {
		  throw new Error('Invalid line range');
		}

		const numOfLeadingSpaces = lines[startLine-1].length - lines[startLine-1].trimStart().length;
	
		const modifiedLines = [...lines.slice(0, startLine - 1), ' '.repeat(numOfLeadingSpaces)+patch, ...lines.slice(endLine)];
		const modifiedContent = modifiedLines.join('\n');
		await fs.writeFile(filePath, modifiedContent, 'utf8');
	
	} catch (error) {
		vscode.window.showErrorMessage(`Error modifying the file: ${error}`);
		// console.error('Error modifying the file:', error);
	  }
}

async function readFile(filePath: string):Promise<string[]> {
	try {
		const data = await fs.readFile(filePath, 'utf8');
		const lines = data.split('\n');
		return lines
	
	  } catch (error) {
		vscode.window.showErrorMessage(`Error reading the file: ${error}`);
		// console.error('Error reading the file:', error);
		return []
	  }
}

async function writeFile(filePath: string, lines:string[]):Promise<void> {
	try {
		await fs.writeFile(filePath, lines.join('\n'), 'utf8');
	
	} catch (error) {
		vscode.window.showErrorMessage(`Error writing the file: ${error}`);
		// console.error('Error writing the file:', error);
	  }
}


async function sendRequestToGeneratePatches(fileName:string, startLine: number, endLine:number, numOfCandidatePatches:number, fileLines:string[]):Promise<string[]> {
	const url = vscode.workspace.getConfiguration('PHPFixer').get('apiUrl', "");
	const requestData = {
		startLine:startLine,
		endLine:endLine,
		fileName: fileName,
		numOfCandidatePatches: numOfCandidatePatches,
		fileLines: fileLines
	}
	try {
		const response: AxiosResponse = await axios.post(url, requestData);
		return response.data['patches'];
	} catch (error) {
		vscode.window.showErrorMessage(`Error generating patches: ${error}`);
		// console.error(error);
		return []
	}
  }

export function activate(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('PHPFixer');

	let disposable = vscode.commands.registerCommand('phpfixer.fix-php', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			const selection = activeEditor.selection;
			const startLine = selection.start.line + 1;
			const endLine = selection.end.line + 1;

			const activeDocument = activeEditor.document;
			const activeFilePath = activeDocument.fileName;

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				const projectDir = workspaceFolders[0].uri.fsPath;

				vscode.window.setStatusBarMessage(`Start running tests`);
				const originalFileLines = await readFile(activeFilePath);

				const numOfCandidatePatches = config.get('numOfCandidatePatches', 5)
				const patchList = await sendRequestToGeneratePatches(activeFilePath, startLine, endLine,  numOfCandidatePatches, originalFileLines);
				

				const plasiblePatches: string[] = [];
				for (let i = 0; i < patchList.length; i++){
					try {
						vscode.window.setStatusBarMessage(`Running tests patch ${i+1}`);
						await modifyFileWithPatch(activeFilePath, startLine, endLine, patchList[i]);
						const testResponse = child_process.execSync('composer tests', { cwd: projectDir, encoding: 'utf-8' });
						if (!testResponse.includes('ERRORS!') && !testResponse.includes('FAILURES!') && testResponse.includes('OK')) {
							plasiblePatches.push(patchList[i]);
						}

					} catch (error: any) {
						console.error(`failed to run test cases: ${error.message}`);
						// vscode.window.showErrorMessage(`failed to run test cases: ${error.message}`);
					}
				}

				if (plasiblePatches.length > 0) {
					const numOfLeadingSpaces = originalFileLines[startLine - 1].length - originalFileLines[startLine - 1].trimStart().length
					let concatenatedPatchList = ' '.repeat(numOfLeadingSpaces) + '// Patch 1 \n' + ' '.repeat(numOfLeadingSpaces) + plasiblePatches[0]
					if (plasiblePatches.length > 1) {
						for (let i = 1; i < plasiblePatches.length; i++){
							concatenatedPatchList += '\n\n';
							concatenatedPatchList += ' '.repeat(numOfLeadingSpaces) + `// Patch ${i+1} \n` + ' '.repeat(numOfLeadingSpaces) + plasiblePatches[i];
						}
					}
					const modifiedLines = [...originalFileLines.slice(0, startLine - 1), concatenatedPatchList, ...originalFileLines.slice(endLine)];
					await writeFile(activeFilePath, modifiedLines);
					vscode.window.showInformationMessage(`Found ${plasiblePatches.length} plasible ${plasiblePatches.length==1?'patches':'patche'}`);
				}
				else {
					await writeFile(activeFilePath, originalFileLines);
					vscode.window.showErrorMessage(`Can not find a plasible patch`);
				}
				vscode.window.setStatusBarMessage('');
			}
		  }
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}