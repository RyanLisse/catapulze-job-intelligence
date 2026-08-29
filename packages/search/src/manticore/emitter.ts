import type { BooleanNode } from "@ji/domain";

const MANTICORE_SPECIAL = /[!"$'()\-/@\\^|~]/;

const escapeTerm = (value: string): string => {
  if (MANTICORE_SPECIAL.test(value)) {
    return `"${value.replaceAll('"', String.raw`\"`)}"`;
  }

  return value;
};

const escapePhrase = (value: string): string =>
  value.replaceAll('"', String.raw`\"`);

const needsGrouping = (node: BooleanNode): boolean =>
  node.kind === "or" || node.kind === "and";

const emitMatchOperand = (node: BooleanNode): string => {
  const emitted = emitMatch(node);
  return needsGrouping(node) ? `(${emitted})` : emitted;
};

export const emitMatch = (node: BooleanNode): string => {
  switch (node.kind) {
    case "term":
      return escapeTerm(node.value);
    case "phrase":
      return `"${escapePhrase(node.value)}"`;
    case "not":
      return `-${emitMatchOperand(node.operand)}`;
    case "and":
      return node.operands.map(emitMatchOperand).join(" ");
    case "or":
      return node.operands.map(emitMatchOperand).join(" | ");
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
    }
  }
};

export const SEARCH_TEXT_FIELDS = "titel,beschrijving" as const;

export const buildQueryString = (ast: BooleanNode | null): string | null => {
  if (ast === null) {
    return null;
  }

  const match = emitMatch(ast);
  if (match.trim().length === 0) {
    return null;
  }

  return `@(${SEARCH_TEXT_FIELDS}) ${match}`;
};

export interface ManticoreBoolQuery {
  bool: {
    minimum_should_match?: number;
    must?: ManticoreQueryClause[];
    must_not?: ManticoreQueryClause[];
    should?: ManticoreQueryClause[];
  };
}

export type ManticoreQueryClause =
  | { match: Record<string, string> }
  | { query_string: string };

const clauseForNode = (node: BooleanNode): ManticoreQueryClause => ({
  query_string: `@(${SEARCH_TEXT_FIELDS}) ${emitMatch(node)}`,
});

export const buildBoolJson = (ast: BooleanNode | null): ManticoreBoolQuery | null => {
  if (ast === null) {
    return null;
  }

  switch (ast.kind) {
    case "term":
    case "phrase":
      return { bool: { must: [clauseForNode(ast)] } };
    case "not":
      return { bool: { must_not: [clauseForNode(ast.operand)] } };
    case "and":
      return {
        bool: {
          must: ast.operands.map((operand) => clauseForNode(operand)),
        },
      };
    case "or":
      return {
        bool: {
          minimum_should_match: 1,
          should: ast.operands.map((operand) => clauseForNode(operand)),
        },
      };
    default: {
      const _exhaustive: never = ast;
      throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
    }
  }
};
