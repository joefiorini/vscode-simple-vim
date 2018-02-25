'use strict';
import * as vscode from 'vscode';

import { Mode } from '../modes_types';
import { Action } from '../action_types';
import {
    parseKeysExact,
    parseKeysOperator,
    createOperatorMotionExactKeys,
    parseKeysRegex,
    createOperatorMotionRegex,
} from '../parse_keys';
import { enterInsertMode, enterVisualMode, enterVisualLineMode, enterNormalMode, setModeCursorStyle } from '../modes';
import * as positionUtils from '../position_utils';
import { removeTypeSubscription } from '../type_subscription';
import { arraySet } from '../array_utils';
import { VimState } from '../vim_state_types';
import { indentLevelRange } from '../indent_utils';
import { quoteRanges, findQuoteRange } from '../quote_utils';
import { setVisualLineSelections } from '../visual_line_utils';

export const actions: Action[] = [
    parseKeysExact(['i'], [Mode.Normal],  function(vimState, editor) {
        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['I'], [Mode.Normal],  function(vimState, editor) {
        editor.selections = editor.selections.map(function(selection) {
            const character = editor.document.lineAt(selection.active.line).firstNonWhitespaceCharacterIndex;
            const newPosition = selection.active.with({ character: character });
            return new vscode.Selection(newPosition, newPosition);
        });

        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['a'], [Mode.Normal],  function(vimState, editor) {
        editor.selections = editor.selections.map(function(selection) {
            const newPosition = positionUtils.right(editor.document, selection.active);
            return new vscode.Selection(newPosition, newPosition);
        });

        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['A'], [Mode.Normal],  function(vimState, editor) {
        editor.selections = editor.selections.map(function(selection) {
            const lineLength = editor.document.lineAt(selection.active.line).text.length;
            const newPosition = selection.active.with({ character: lineLength });
            return new vscode.Selection(newPosition, newPosition);
        });

        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['v'], [Mode.Normal, Mode.VisualLine],  function(vimState, editor) {
        if (vimState.mode === Mode.Normal) {
            editor.selections = editor.selections.map(function(selection) {
                const lineLength = editor.document.lineAt(selection.active.line).text.length;

                if (lineLength === 0) return selection;

                return new vscode.Selection(selection.active, positionUtils.right(editor.document, selection.active));
            });
        }

        enterVisualMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
    }),

    parseKeysExact(['V'], [Mode.Normal, Mode.Visual],  function(vimState, editor) {
        enterVisualLineMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        setVisualLineSelections(editor);
    }),

    parseKeysExact(['p'], [Mode.Normal, Mode.Visual, Mode.VisualLine],  function(vimState, editor) {
        const document = editor.document;

        if (vimState.mode === Mode.Normal) {
            editor.edit(function(editBuilder) {
                editor.selections.forEach(function(selection, i) {
                    const registerArray = vimState.registers['"'];
                    if (registerArray === undefined) return;
                    const register = registerArray[i];
                    if (register === undefined) return;

                    if (register.linewise) {
                        const insertPosition = new vscode.Position(selection.active.line + 1, 0);
                        editBuilder.insert(insertPosition, register.contents + '\n');
                    } else {
                        const insertPosition = positionUtils.right(document, selection.active);

                        // Move cursor to the insert position so it will end up at the end of the inserted text
                        editor.selections = arraySet(
                            editor.selections,
                            i,
                            new vscode.Selection(insertPosition, insertPosition),
                        );

                        // Insert text
                        editBuilder.insert(insertPosition, register.contents);
                    }
                });
            }).then(function() {
                editor.selections = editor.selections.map(function(selection, i) {
                    const registerArray = vimState.registers['"'];
                    if (registerArray === undefined) return selection;
                    const register = registerArray[i];
                    if (register === undefined) return selection;

                    if (register.linewise) {
                        const newPosition = new vscode.Position(selection.active.line + 1, 0);
                        return new vscode.Selection(newPosition, newPosition);
                    } else {
                        // Cursor ends up after the insertion so move it one to
                        // the left so it's under the last inserted character
                        const newPosition = positionUtils.left(selection.active);
                        return new vscode.Selection(newPosition, newPosition);
                    }
                });
            });
        } else if (vimState.mode === Mode.Visual) {
            editor.edit(function(editBuilder) {
                editor.selections.forEach(function(selection, i) {
                    const registerArray = vimState.registers['"'];
                    if (registerArray === undefined) return;
                    const register = registerArray[i];
                    if (register === undefined) return;

                    const contents = register.linewise ? '\n' + register.contents + '\n' : register.contents;

                    editBuilder.delete(selection);
                    editBuilder.insert(selection.start, contents);
                });
            }).then(function() {
                editor.selections = editor.selections.map(function(selection) {
                    const newPosition = positionUtils.left(selection.active);
                    return new vscode.Selection(newPosition, newPosition);
                });
            });

            enterNormalMode(vimState);
            setModeCursorStyle(vimState.mode, editor);
        } else {
            editor.edit(function(editBuilder) {
                editor.selections.forEach(function(selection, i) {
                    const registerArray = vimState.registers['"'];
                    if (registerArray === undefined) return;
                    const register = registerArray[i];
                    if (register === undefined) return;

                    editBuilder.replace(selection, register.contents);
                });
            }).then(function() {
                editor.selections = editor.selections.map(function(selection) {
                    return new vscode.Selection(selection.start, selection.start);
                });

                enterNormalMode(vimState);
                setModeCursorStyle(vimState.mode, editor);
            });
        }

        vimState.desiredColumns = [];
    }),

    parseKeysExact(['P'], [Mode.Normal],  function(vimState, editor) {
        const document = editor.document;

        editor.edit(function(editBuilder) {
            editor.selections.forEach(function(selection, i) {
                const registerArray = vimState.registers['"'];
                if (registerArray === undefined) return;
                const register = registerArray[i];
                if (register === undefined) return;

                if (register.linewise) {
                    const insertPosition = new vscode.Position(selection.active.line, 0);
                    editBuilder.insert(insertPosition, register.contents + '\n');
                } else {
                    editBuilder.insert(selection.active, register.contents);
                }
            });
        }).then(function() {
            editor.selections = editor.selections.map(function(selection, i) {
                const registerArray = vimState.registers['"'];
                if (registerArray === undefined) return selection;
                const register = registerArray[i];
                if (register === undefined) return selection;

                if (register.linewise) {
                    const newPosition = new vscode.Position(selection.active.line, 0);
                    return new vscode.Selection(newPosition, newPosition);
                } else {
                    // Cursor ends up after the insertion so move it one to
                    // the left so it's under the last inserted character
                    const newPosition = positionUtils.left(selection.active);
                    return new vscode.Selection(newPosition, newPosition);
                }
            });
        });

        vimState.desiredColumns = [];
    }),

    parseKeysExact(['u'], [Mode.Normal, Mode.Visual, Mode.VisualLine],  function(vimState, editor) {
        vscode.commands.executeCommand('undo');
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['d', 'd'], [Mode.Normal],  function(vimState, editor) {
        deleteLine(vimState, editor);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['D'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('deleteAllRight');
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['c', 'c'], [Mode.Normal],  function(vimState, editor) {
        editor.edit(function(editBuilder) {
            editor.selections.forEach(function(selection) {
                const line = editor.document.lineAt(selection.active.line);
                editBuilder.delete(new vscode.Range(
                    selection.active.with({ character: line.firstNonWhitespaceCharacterIndex }),
                    selection.active.with({ character: line.text.length }),
                ));
            });
        });

        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['C'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('deleteAllRight');
        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['o'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('editor.action.insertLineAfter');
        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['O'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('editor.action.insertLineBefore');
        enterInsertMode(vimState);
        setModeCursorStyle(vimState.mode, editor);
        removeTypeSubscription(vimState);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['H'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('cursorMove', { to: 'viewPortTop', by: 'line' });
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['M'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('cursorMove', { to: 'viewPortCenter', by: 'line' });
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['L'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('cursorMove', { to: 'viewPortBottom', by: 'line' });
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['z', 't'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('revealLine', {
            lineNumber: editor.selection.active.line,
            at: 'top',
        });
    }),

    parseKeysExact(['z', 'z'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('revealLine', {
            lineNumber: editor.selection.active.line,
            at: 'center',
        });
    }),

    parseKeysExact(['z', 'b'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('revealLine', {
            lineNumber: editor.selection.active.line,
            at: 'bottom',
        });
    }),

    parseKeysExact(['y', 'y'], [Mode.Normal],  function(vimState, editor) {
        yankLine(vimState, editor);
    }),

    parseKeysExact(['Y'], [Mode.Normal],  function(vimState, editor) {
        yankToEndOfLine(vimState, editor);
    }),

    parseKeysExact(['r', 'r'], [Mode.Normal],  function(vimState, editor) {
        yankLine(vimState, editor);
        deleteLine(vimState, editor);
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['R'], [Mode.Normal],  function(vimState, editor) {
        yankToEndOfLine(vimState, editor);
        vscode.commands.executeCommand('deleteAllRight');
        vimState.desiredColumns = [];
    }),

    parseKeysExact(['x'], [Mode.Normal],  function(vimState, editor) {
        vscode.commands.executeCommand('deleteRight');
        vimState.desiredColumns = [];
    }),

    parseKeysExact([';'], [Mode.Normal],  function(vimState, editor) {
        vimState.semicolonAction(vimState, editor);
    }),

    parseKeysExact([','], [Mode.Normal],  function(vimState, editor) {
        vimState.commaAction(vimState, editor);
    }),

    // Use the s operator instead of these

    // parseKeysExact(['i', 'i'], [Mode.Visual, Mode.VisualLine],  function(vimState, editor) {
    //     const document = editor.document;

    //     editor.selections = editor.selections.map(function(selection) {
    //         const simpleRange = indentLevelRange(document, selection.active.line);

    //         return new vscode.Selection(
    //             new vscode.Position(simpleRange.start, 0),
    //             new vscode.Position(simpleRange.end, document.lineAt(simpleRange.end).text.length),
    //         );
    //     });

    //     if (vimState.mode === Mode.Visual) {
    //         enterVisualLineMode(vimState);
    //         setModeCursorStyle(vimState.mode, editor);
    //     }
    // }),

    // parseKeysExact(['i', "'"], [Mode.Visual, Mode.VisualLine],  function(vimState, editor) {
    //     const document = editor.document;

    //     editor.selections = editor.selections.map(function(selection) {
    //         const position = selection.isReversed ? selection.active : positionUtils.left(selection.active);
    //         const lineText = document.lineAt(position.line).text;
    //         const ranges = quoteRanges("'", lineText);
    //         const result = findQuoteRange(ranges, position);

    //         if (result) {
    //             return new vscode.Selection(
    //                 position.with({ character: result.start + 1 }),
    //                 position.with({ character: result.end }),
    //             );
    //         } else {
    //             return selection;
    //         }
    //     });
    // }),
];

function deleteLine(vimState: VimState, editor: vscode.TextEditor): void {
    vscode.commands.executeCommand('editor.action.deleteLines').then(function() {
        editor.selections = editor.selections.map(function(selection) {
            const character = editor.document.lineAt(selection.active.line).firstNonWhitespaceCharacterIndex;
            const newPosition = selection.active.with({ character: character });
            return new vscode.Selection(newPosition, newPosition);
        });
    });
}

function yankLine(vimState: VimState, editor: vscode.TextEditor): void {
    vimState.registers['"'] = editor.selections.map(function(selection) {
        return {
            contents: editor.document.lineAt(selection.active.line).text,
            linewise: true,
        };
    });
}

function yankToEndOfLine(vimState: VimState, editor: vscode.TextEditor): void {
    vimState.registers['"'] = editor.selections.map(function(selection) {
        return {
            contents: editor.document.lineAt(selection.active.line).text.substring(selection.active.character),
            linewise: false,
        };
    });
}
