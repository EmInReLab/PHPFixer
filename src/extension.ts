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
	// vscode.window.showErrorMessage(`url ${url}`);
	
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


let cancellationToken: boolean = false;

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('phpfixer.fix-php', async () => {

		const config = vscode.workspace.getConfiguration('PHPFixer');
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			const selection = activeEditor.selection;
			const startLine = selection.start.line + 1;
			const endLine = selection.end.line + 1;

			const activeDocument = activeEditor.document;
			const activeFilePath = activeDocument.fileName;
			const fileName = activeFilePath.split("\\").pop();

			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (workspaceFolders && workspaceFolders.length > 0) {
				const projectDir = workspaceFolders[0].uri.fsPath;

				/* @ts-ignore */
				const testCommand = 'composer tests tests/' + fileName.replace('.php', 'Test.php')

				// run test for existing patch
				vscode.window.setStatusBarMessage(`Running tests`);
				let testResponse =''
				try {
					testResponse = child_process.execSync(testCommand, { cwd: projectDir, encoding: 'utf-8' });
				} catch (error:any) {
					console.error(`failed to run test cases: ${error.message}`);
				}


				if (!testResponse.includes('ERRORS!') && !testResponse.includes('FAILURES!') && testResponse.includes('OK')) {
					vscode.window.showInformationMessage(`Can not identify a bug your code. please update your test cases.`);
				}
				else {
					const originalFileLines = await readFile(activeFilePath);
					const numOfCandidatePatches = config.get('numOfCandidatePatches', 5);
	
					vscode.window.setStatusBarMessage(`Generating patches`);
	
	
					/* @ts-ignore */
					const patchList = await sendRequestToGeneratePatches(fileName, startLine, endLine,  numOfCandidatePatches, originalFileLines);
					await fs.writeFile(projectDir+'/phpfixer-log.txt', 'Candidate Patches \n'+patchList.join('\n'), 'utf8');
	
					
					vscode.window.setStatusBarMessage(`Start running tests`);
					const plasiblePatches: string[] = [];
					for (let i = 0; i < patchList.length; i++){
						if (cancellationToken || (config.get('isStopFirstPlausiblePatch', false) && plasiblePatches.length > 0)) {
							cancellationToken = false;
							break;
						}
						else {
							try {
								vscode.window.setStatusBarMessage(`Running tests patch ${i+1}/${patchList.length}`);
								await modifyFileWithPatch(activeFilePath, startLine, endLine, patchList[i]);
								const testResponse = child_process.execSync(testCommand, { cwd: projectDir, encoding: 'utf-8' });
								if (!testResponse.includes('ERRORS!') && !testResponse.includes('FAILURES!') && testResponse.includes('OK')) {
									plasiblePatches.push(patchList[i]);
								}
		
							} catch (error: any) {
								console.error(`failed to run test cases: ${error.message}`);
								// vscode.window.showErrorMessage(`failed to run test cases: ${error.message}`);
							}
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
						vscode.window.showInformationMessage(`Found ${plasiblePatches.length} plasible ${plasiblePatches.length == 1 ? 'patches' : 'patche'}`);
	
						await fs.appendFile(projectDir+'/phpfixer-log.txt', '\n\nPlausible Patches \n'+plasiblePatches.join('\n'), 'utf8');
					}
					else {
						await writeFile(activeFilePath, originalFileLines);
						vscode.window.showErrorMessage(`Can not find a plasible patch`);
					}
				}
				vscode.window.setStatusBarMessage('');
			}
		  }
	});

	context.subscriptions.push(disposable);
	
	// Register a command to cancel the long-running command
	disposable = vscode.commands.registerCommand('phpfixer.cancelTestRunning', () => {
		// Cancel the command if it is running
		cancellationToken = true;
	});
}

// This method is called when your extension is deactivated
export function deactivate() {}