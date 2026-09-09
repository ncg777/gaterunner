export type MathExpressionValue = number | number[];

export interface MathExpressionFunction {
  minArgs: number;
  maxArgs: number;
  evaluate: (args: MathExpressionValue[]) => MathExpressionValue;
}

export interface MathExpressionProfile {
  input: string;
  functions: ReadonlyMap<string, MathExpressionFunction>;
  strict: boolean;
  allowParameters: boolean;
  legacyAssignment?: boolean;
}

export interface CompiledMathExpression {
  readonly parameters: readonly string[];
  evaluate(input: number, parameters?: Readonly<Record<string, number>>): MathExpressionValue;
}

type AstNode =
  | { kind: 'number'; value: number; height: number }
  | { kind: 'variable'; name: string; height: number }
  | { kind: 'unary'; op: string; arg: AstNode; height: number }
  | { kind: 'binary'; op: string; left: AstNode; right: AstNode; height: number }
  | { kind: 'call'; name: string; args: AstNode[]; height: number };

interface Token {
  type: 'number' | 'identifier' | 'symbol' | 'eof';
  value: string;
  pos: number;
}

const reservedNames = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  ...Object.getOwnPropertyNames(Function.prototype),
  'prototype', '__proto__', 'arguments', 'caller', 'callee',
  'x', 'y', 'T', 'PI', 'E', 'Math', 'Date', 'Infinity', 'NaN', 'undefined',
  'eval', 'Function', 'globalThis', 'window', 'document', 'global', 'process',
  'require', 'import', 'this', 'new', 'return', 'function', 'class', 'delete',
  'typeof', 'void', 'instanceof', 'in', 'of', 'await', 'async', 'yield',
  'let', 'const', 'var', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'break', 'continue', 'try', 'catch', 'finally', 'throw', 'default', 'export',
  'extends', 'super', 'null', 'true', 'false', 'with', 'debugger', 'time', 'random',
  'enum', 'implements', 'interface', 'package', 'private', 'protected', 'public', 'static',
  'performance', 'setTimeout', 'setInterval', 'seq', 'wform', 'stowform',
  'integer', 'saw_wform', 'revsaw_wform', 'triangle_wform',
]);

export function expressionNumber(value: MathExpressionValue): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Expected a finite number value.');
  }
  return value;
}

const scalarFunctions = new Map<string, MathExpressionFunction>();
for (const [name, operation] of Object.entries({
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, tanh: Math.tanh, sinh: Math.sinh, cosh: Math.cosh,
  sqrt: Math.sqrt, abs: Math.abs, sign: Math.sign, exp: Math.exp,
  log: Math.log, log10: Math.log10, floor: Math.floor, ceil: Math.ceil, round: Math.round,
})) {
  scalarFunctions.set(name, {
    minArgs: 1, maxArgs: 1,
    evaluate: (args) => operation(expressionNumber(args[0])),
  });
}
for (const [name, operation] of Object.entries({ pow: Math.pow, atan2: Math.atan2 })) {
  scalarFunctions.set(name, {
    minArgs: 2, maxArgs: 2,
    evaluate: (args) => operation(expressionNumber(args[0]), expressionNumber(args[1])),
  });
}
scalarFunctions.set('tan', {
  minArgs: 1, maxArgs: 1,
  evaluate: (args) => {
    const value = expressionNumber(args[0]);
    if (Math.abs(value % Math.PI) === Math.PI / 2) throw new Error('Tangent is undefined at this input.');
    return Math.tan(value);
  },
});
for (const [name, operation] of Object.entries({ min: Math.min, max: Math.max })) {
  scalarFunctions.set(name, {
    minArgs: 1, maxArgs: 256,
    evaluate: (args) => operation(...args.map(expressionNumber)),
  });
}
scalarFunctions.set('clamp', {
  minArgs: 3, maxArgs: 3,
  evaluate: (args) => {
    const [value, minimum, maximum] = args.map(expressionNumber);
    if (minimum > maximum) throw new Error('Invalid clamp bounds.');
    return Math.min(maximum, Math.max(minimum, value));
  },
});

export const WAVESHAPER_EXPRESSION_PROFILE: MathExpressionProfile = {
  input: 'x', functions: scalarFunctions, strict: true, allowParameters: true,
};

export function isMathParameterName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(name)
    && !reservedNames.has(name) && !scalarFunctions.has(name);
}

function tokenize(expression: string, strict: boolean): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      const start = index;
      if (strict) {
        const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(expression.slice(index));
        if (!match) throw new Error(`Invalid number at position ${index}.`);
        index += match[0].length;
      } else {
        let hasDigit = false;
        let hasDot = false;
        while (index < expression.length) {
          const current = expression[index];
          if (/[0-9]/.test(current)) {
            hasDigit = true;
            index += 1;
          } else if (current === '.' && !hasDot) {
            hasDot = true;
            index += 1;
          } else if ((current === 'e' || current === 'E') && hasDigit
            && /^[+-]?\d/.test(expression.slice(index + 1))) {
            index += 1;
            if (/[+-]/.test(expression[index])) index += 1;
            while (index < expression.length && /[0-9]/.test(expression[index])) index += 1;
          } else break;
        }
      }
      const value = expression.slice(start, index);
      if (!Number.isFinite(Number.parseFloat(value))) throw new Error(`Invalid number '${value}'.`);
      tokens.push({ type: 'number', value, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index++;
      while (index < expression.length && /[A-Za-z0-9_]/.test(expression[index])) index += 1;
      const value = expression.slice(start, index);
      if (value.length > 32) throw new Error('Identifier exceeds 32 characters.');
      tokens.push({ type: 'identifier', value, pos: start });
      continue;
    }
    if ('+-*/%^(),'.includes(char)) {
      tokens.push({ type: 'symbol', value: char, pos: index++ });
      continue;
    }
    throw new Error(`Invalid token '${char}' at position ${index}.`);
  }
  tokens.push({ type: 'eof', value: '', pos: expression.length });
  return tokens;
}

class Parser {
  private index = 0;
  private nodes = 0;
  readonly parameters = new Set<string>();

  constructor(private tokens: Token[], private profile: MathExpressionProfile) {}

  parse(): AstNode {
    const node = this.expression(0, 0);
    if (this.peek().type !== 'eof') throw new Error(`Unexpected token '${this.peek().value}'.`);
    return node;
  }

  private expression(minimum: number, depth: number): AstNode {
    if (depth > 32) throw new Error('Expression exceeds depth 32.');
    let node = this.primary(depth);
    while (this.peek().type === 'symbol') {
      const op = this.peek().value;
      const precedence = op === '+' || op === '-' ? 1
        : op === '*' || op === '/' || op === '%' ? 2 : op === '^' ? 3 : 0;
      if (!precedence || precedence < minimum) break;
      this.index += 1;
      const right = this.expression(op === '^' ? precedence : precedence + 1, depth + 1);
      node = this.make({ kind: 'binary', op, left: node, right, height: 1 + Math.max(node.height, right.height) });
    }
    return node;
  }

  private primary(depth: number): AstNode {
    if (depth > 32) throw new Error('Expression exceeds depth 32.');
    const token = this.tokens[this.index++];
    if (token.type === 'number') {
      return this.make({ kind: 'number', value: Number.parseFloat(token.value), height: 1 });
    }
    if (token.value === '+' || token.value === '-') {
      const arg = this.primary(depth + 1);
      return this.make({ kind: 'unary', op: token.value, arg, height: arg.height + 1 });
    }
    if (token.value === '(') {
      const node = this.expression(0, depth + 1);
      this.close();
      return node;
    }
    if (token.type === 'identifier') {
      const name = token.value;
      if (this.peek().value === '(') {
        const operation = this.profile.functions.get(name);
        if (!operation) throw new Error(`Unknown function '${name}'.`);
        this.index += 1;
        const args: AstNode[] = [];
        if (this.peek().value !== ')') {
          do {
            args.push(this.expression(0, depth + 1));
            if (this.peek().value !== ',') break;
            this.index += 1;
          } while (true);
        }
        this.close();
        if (args.length < operation.minArgs || args.length > operation.maxArgs) {
          throw new Error(`Invalid arity for '${name}'.`);
        }
        return this.make({ kind: 'call', name, args, height: 1 + Math.max(0, ...args.map((arg) => arg.height)) });
      }
      if (name !== this.profile.input && name !== 'PI' && name !== 'E') {
        if (!this.profile.allowParameters || !isMathParameterName(name) || this.profile.functions.has(name)) {
          throw new Error(`Unknown identifier '${name}'.`);
        }
        this.parameters.add(name);
        if (this.parameters.size > 16) throw new Error('Expression exceeds 16 free parameters.');
      }
      return this.make({ kind: 'variable', name, height: 1 });
    }
    throw new Error(`Unexpected token '${token.value}' at position ${token.pos}.`);
  }

  private make(node: AstNode): AstNode {
    if (++this.nodes > 256) throw new Error('Expression exceeds 256 nodes.');
    if (node.height > 32) throw new Error('Expression exceeds depth 32.');
    return node;
  }

  private peek(): Token { return this.tokens[this.index]; }

  private close(): void {
    if (this.peek().value !== ')') throw new Error(`Expected ')' at position ${this.peek().pos}.`);
    this.index += 1;
  }
}

function evaluate(node: AstNode, input: number, parameters: Readonly<Record<string, number>>, profile: MathExpressionProfile): MathExpressionValue {
  let result: MathExpressionValue;
  switch (node.kind) {
    case 'number': result = node.value; break;
    case 'variable': {
      const descriptor = Object.getOwnPropertyDescriptor(parameters, node.name);
      result = node.name === profile.input ? input : node.name === 'PI' ? Math.PI : node.name === 'E' ? Math.E
        : descriptor && 'value' in descriptor ? descriptor.value : NaN;
      break;
    }
    case 'unary': {
      const value = expressionNumber(evaluate(node.arg, input, parameters, profile));
      result = node.op === '-' ? -value : value;
      break;
    }
    case 'binary': {
      const left = expressionNumber(evaluate(node.left, input, parameters, profile));
      const right = expressionNumber(evaluate(node.right, input, parameters, profile));
      if ((node.op === '/' || node.op === '%') && right === 0) {
        if (profile.strict) throw new Error('Division by zero.');
        result = 0;
      } else {
        switch (node.op) {
          case '+': result = left + right; break;
          case '-': result = left - right; break;
          case '*': result = left * right; break;
          case '/': result = left / right; break;
          case '%': result = left % right; break;
          default: result = Math.pow(left, right);
        }
      }
      break;
    }
    case 'call':
      result = profile.functions.get(node.name)!.evaluate(node.args.map((arg) => evaluate(arg, input, parameters, profile)));
      break;
  }
  return profile.strict ? expressionNumber(result) : result;
}

const astCache = new Map<string, CompiledMathExpression>();
const profileIds = new WeakMap<MathExpressionProfile, number>();
let nextProfileId = 0;

export function compileMathExpression(source: string, profile = WAVESHAPER_EXPRESSION_PROFILE): CompiledMathExpression {
  const raw = source.trim();
  if (profile.strict && source.length > 512) throw new Error('Expression exceeds 512 characters.');
  const expression = raw.replace(profile.legacyAssignment ? /^Y\s*=\s*/i : /^y\s*=\s*/, '');
  if (!expression) throw new Error('Expression is empty.');
  if (expression.length > 512) throw new Error('Expression exceeds 512 characters.');
  if (!profileIds.has(profile)) profileIds.set(profile, ++nextProfileId);
  const key = `${profileIds.get(profile)}:${expression}`;
  const cached = astCache.get(key);
  if (cached) {
    astCache.delete(key);
    astCache.set(key, cached);
    return cached;
  }
  const parser = new Parser(tokenize(expression, profile.strict), profile);
  const ast = parser.parse();
  const compiled = Object.freeze({
    parameters: Object.freeze([...parser.parameters]),
    evaluate: (input: number, parameters: Readonly<Record<string, number>> = {}) => {
      if (profile.strict) expressionNumber(input);
      return evaluate(ast, input, parameters, profile);
    },
  });
  astCache.set(key, compiled);
  if (astCache.size > 128) astCache.delete(astCache.keys().next().value!);
  return compiled;
}