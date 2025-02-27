/**
 * @license
 * Copyright 2014 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Helper functions for generating Dart for blocks.
 * @suppress {checkTypes|globalThis}
 */

// Former goog.module ID: Blockly.Dart

import * as Variables from '../../core/variables.js';
import * as stringUtils from '../../core/utils/string.js';
// import type {Block} from '../../core/block.js';
import {CodeGenerator} from '../../core/generator.js';
import {Names, NameType} from '../../core/names.js';
// import type {Workspace} from '../../core/workspace.js';
import {inputTypes} from '../../core/inputs/input_types.js';


/**
 * Order of operation ENUMs.
 * https://dart.dev/guides/language/language-tour#operators
 * @enum {number}
 */
export const Order = {
  ATOMIC: 0,         // 0 "" ...
  UNARY_POSTFIX: 1,  // expr++ expr-- () [] . ?.
  UNARY_PREFIX: 2,   // -expr !expr ~expr ++expr --expr
  MULTIPLICATIVE: 3, // * / % ~/
  ADDITIVE: 4,       // + -
  SHIFT: 5,          // << >>
  BITWISE_AND: 6,    // &
  BITWISE_XOR: 7,    // ^
  BITWISE_OR: 8,     // |
  RELATIONAL: 9,     // >= > <= < as is is!
  EQUALITY: 10,      // == !=
  LOGICAL_AND: 11,   // &&
  LOGICAL_OR: 12,    // ||
  IF_NULL: 13,       // ??
  CONDITIONAL: 14,   // expr ? expr : expr
  CASCADE: 15,       // ..
  ASSIGNMENT: 16,    // = *= /= ~/= %= += -= <<= >>= &= ^= |=
  NONE: 99,          // (...)
};

/**
 * Dart code generator class.
 */
export class DartGenerator extends CodeGenerator {
  constructor(name) {
    super(name ?? 'Dart');
    this.isInitialized = false;

    // Copy Order values onto instance for backwards compatibility
    // while ensuring they are not part of the publically-advertised
    // API.
    //
    // TODO(#7085): deprecate these in due course.  (Could initially
    // replace data properties with get accessors that call
    // deprecate.warn().)
    for (const key in Order) {
      this['ORDER_' + key] = Order[key];
    }

    // List of illegal variable names.  This is not intended to be a
    // security feature.  Blockly is 100% client-side, so bypassing
    // this list is trivial.  This is intended to prevent users from
    // accidentally clobbering a built-in object or function.
    this.addReservedWords(
      // https://www.dartlang.org/docs/spec/latest/dart-language-specification.pdf
      // Section 16.1.1
      'assert,break,case,catch,class,const,continue,default,do,else,enum,' +
      'extends,false,final,finally,for,if,in,is,new,null,rethrow,return,' +
      'super,switch,this,throw,true,try,var,void,while,with,' +
      // https://api.dartlang.org/dart_core.html
      'print,identityHashCode,identical,BidirectionalIterator,Comparable,' +
      'double,Function,int,Invocation,Iterable,Iterator,List,Map,Match,num,' +
      'Pattern,RegExp,Set,StackTrace,String,StringSink,Type,bool,DateTime,' +
      'Deprecated,Duration,Expando,Null,Object,RuneIterator,Runes,Stopwatch,' +
      'StringBuffer,Symbol,Uri,Comparator,AbstractClassInstantiationError,' +
      'ArgumentError,AssertionError,CastError,ConcurrentModificationError,' +
      'CyclicInitializationError,Error,Exception,FallThroughError,' +
      'FormatException,IntegerDivisionByZeroException,NoSuchMethodError,' +
      'NullThrownError,OutOfMemoryError,RangeError,StackOverflowError,' +
      'StateError,TypeError,UnimplementedError,UnsupportedError'
    );
  }

  /**
   * Initialise the database of variable names.
   * @param {!Workspace} workspace Workspace to generate code from.
   */
  init(workspace) {
    super.init();

    if (!this.nameDB_) {
      this.nameDB_ = new Names(this.RESERVED_WORDS_);
    } else {
      this.nameDB_.reset();
    }

    this.nameDB_.setVariableMap(workspace.getVariableMap());
    this.nameDB_.populateVariables(workspace);
    this.nameDB_.populateProcedures(workspace);

    const defvars = [];
    // Add developer variables (not created or named by the user).
    const devVarList = Variables.allDeveloperVariables(workspace);
    for (let i = 0; i < devVarList.length; i++) {
      defvars.push(this.nameDB_.getName(devVarList[i],
                                        NameType.DEVELOPER_VARIABLE));
    }

    // Add user variables, but only ones that are being used.
    const variables = Variables.allUsedVarModels(workspace);
    for (let i = 0; i < variables.length; i++) {
      defvars.push(this.nameDB_.getName(variables[i].getId(),
                                        NameType.VARIABLE));
    }

    // Declare all of the variables.
    if (defvars.length) {
      this.definitions_['variables'] =
          'var ' + defvars.join(', ') + ';';
    }
    this.isInitialized = true;
  }

  /**
   * Prepend the generated code with import statements and variable definitions.
   * @param {string} code Generated code.
   * @return {string} Completed code.
   */
  finish(code) {
    // Indent every line.
    if (code) {
      code = this.prefixLines(code, this.INDENT);
    }
    code = 'main() {\n' + code + '}';

    // Convert the definitions dictionary into a list.
    const imports = [];
    const definitions = [];
    for (let name in this.definitions_) {
      const def = this.definitions_[name];
      if (def.match(/^import\s/)) {
        imports.push(def);
      } else {
        definitions.push(def);
      }
    }
    // Call Blockly.CodeGenerator's finish.
    code = super.finish(code);
    this.isInitialized = false;

    this.nameDB_.reset();
    const allDefs = imports.join('\n') + '\n\n' + definitions.join('\n\n');
    return allDefs.replace(/\n\n+/g, '\n\n').replace(/\n*$/, '\n\n\n') + code;
  }

  /**
   * Naked values are top-level blocks with outputs that aren't plugged into
   * anything.  A trailing semicolon is needed to make this legal.
   * @param {string} line Line of generated code.
   * @return {string} Legal line of code.
   */
  scrubNakedValue(line) {
    return line + ';\n';
  }

  /**
   * Encode a string as a properly escaped Dart string, complete with quotes.
   * @param {string} string Text to encode.
   * @return {string} Dart string.
   */
  quote_(string) {
    // Can't use goog.string.quote since $ must also be escaped.
    string = string.replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\\n')
        .replace(/\$/g, '\\$')
        .replace(/'/g, '\\\'');
    return '\'' + string + '\'';
  }

  /**
   * Encode a string as a properly escaped multiline Dart string, complete with
   * quotes.
   * @param {string} string Text to encode.
   * @return {string} Dart string.
   */
  multiline_quote_(string) {
    const lines = string.split(/\n/g).map(this.quote_);
    // Join with the following, plus a newline:
    // + '\n' +
    return lines.join(' + \'\\n\' + \n');
  }

  /**
   * Common tasks for generating Dart from blocks.
   * Handles comments for the specified block and any connected value blocks.
   * Calls any statements following this block.
   * @param {!Block} block The current block.
   * @param {string} code The Dart code created for this block.
   * @param {boolean=} opt_thisOnly True to generate code for only this
   *     statement.
   * @return {string} Dart code with comments and subsequent blocks added.
   * @protected
   */
  scrub_(block, code, opt_thisOnly) {
    let commentCode = '';
    // Only collect comments for blocks that aren't inline.
    if (!block.outputConnection || !block.outputConnection.targetConnection) {
      // Collect comment for this block.
      let comment = block.getCommentText();
      if (comment) {
        comment = stringUtils.wrap(comment, this.COMMENT_WRAP - 3);
        if (block.getProcedureDef) {
          // Use documentation comment for function comments.
          commentCode += this.prefixLines(comment + '\n', '/// ');
        } else {
          commentCode += this.prefixLines(comment + '\n', '// ');
        }
      }
      // Collect comments for all value arguments.
      // Don't collect comments for nested statements.
      for (let i = 0; i < block.inputList.length; i++) {
        if (block.inputList[i].type === inputTypes.VALUE) {
          const childBlock = block.inputList[i].connection.targetBlock();
          if (childBlock) {
            comment = this.allNestedComments(childBlock);
            if (comment) {
              commentCode += this.prefixLines(comment, '// ');
            }
          }
        }
      }
    }
    const nextBlock =
        block.nextConnection && block.nextConnection.targetBlock();
    const nextCode = opt_thisOnly ? '' : this.blockToCode(nextBlock);
    return commentCode + code + nextCode;
  }

  /**
   * Gets a property and adjusts the value while taking into account indexing.
   * @param {!Block} block The block.
   * @param {string} atId The property ID of the element to get.
   * @param {number=} opt_delta Value to add.
   * @param {boolean=} opt_negate Whether to negate the value.
   * @param {number=} opt_order The highest order acting on this value.
   * @return {string|number}
   */
  getAdjusted(block, atId, opt_delta, opt_negate, opt_order) {
    let delta = opt_delta || 0;
    let order = opt_order || this.ORDER_NONE;
    if (block.workspace.options.oneBasedIndex) {
      delta--;
    }
    const defaultAtIndex = block.workspace.options.oneBasedIndex ? '1' : '0';

    /** @type {number} */
    let outerOrder;
    let innerOrder;
    if (delta) {
      outerOrder = this.ORDER_ADDITIVE;
      innerOrder = this.ORDER_ADDITIVE;
    } else if (opt_negate) {
      outerOrder = this.ORDER_UNARY_PREFIX;
      innerOrder = this.ORDER_UNARY_PREFIX;
    } else {
      outerOrder = order;
    }

    /** @type {string|number} */
    let at = this.valueToCode(block, atId, outerOrder) || defaultAtIndex;

    if (stringUtils.isNumber(at)) {
      // If the index is a naked number, adjust it right now.
      at = parseInt(at, 10) + delta;
      if (opt_negate) {
        at = -at;
      }
    } else {
      // If the index is dynamic, adjust it in code.
      if (delta > 0) {
        at = at + ' + ' + delta;
      } else if (delta < 0) {
        at = at + ' - ' + -delta;
      }
      if (opt_negate) {
        if (delta) {
          at = '-(' + at + ')';
        } else {
          at = '-' + at;
        }
      }
      innerOrder = Math.floor(innerOrder);
      order = Math.floor(order);
      if (innerOrder && order >= innerOrder) {
        at = '(' + at + ')';
      }
    }
    return at;
  }
}
