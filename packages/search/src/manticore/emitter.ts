import type { BooleanNode } from "@ji/domain";

const MANTICORE_SPECIAL = /[!"$'()\-/@\\^|~]/u;

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

export const emitMatch = (node: BooleanNode): string => {
  switch (node.kind) {
    case "term": {
      return escapeTerm(node.value);
    }
    case "phrase": {
      return `"${escapePhrase(node.value)}"`;
    }
    case "not": {
      const operand = emitMatch(node.operand);
      return needsGrouping(node.operand) ? `-(${operand})` : `-${operand}`;
    }
    case "and": {
      return node.operands
        .map((operand) => {
          const emitted = emitMatch(operand);
          return needsGrouping(operand) ? `(${emitted})` : emitted;
        })
        .join(" ");
    }
    case "or": {
      return node.operands
        .map((operand) => {
          const emitted = emitMatch(operand);
          return needsGrouping(operand) ? `(${emitted})` : emitted;
        })
        .join(" | ");
    }
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

const collectPositiveText = (node: BooleanNode): string[] => {
  switch (node.kind) {
    case "term":
    case "phrase": {
      const value = node.value.trim();
      return value.length === 0 ? [] : [value];
    }
    case "not": {
      return [];
    }
    case "and":
    case "or": {
      return node.operands.flatMap(collectPositiveText);
    }
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
    }
  }
};

/** Natural-language input for auto-embedding; Boolean operators and negated text are omitted. */
export const buildKnnQueryText = (ast: BooleanNode | null): string | null => {
  if (ast === null) {
    return null;
  }
  const text = collectPositiveText(ast).join(" ");
  return text.length === 0 ? null : text;
};

export interface ManticoreBoolQuery {
  bool: {
    minimum_should_match?: number;
    must?: ManticoreQueryClause[];
    must_not?: ManticoreQueryClause[];
    should?: ManticoreQueryClause[];
  };
}

export interface ManticoreQueryStringClause {
  query_string: string;
}

export interface ManticoreMatchClause {
  match: Record<string, string>;
}

export type ManticoreQueryClause =
  | ManticoreMatchClause
  | ManticoreQueryStringClause;

const clauseForNode = (node: BooleanNode): ManticoreQueryStringClause => ({
  query_string: `@(${SEARCH_TEXT_FIELDS}) ${emitMatch(node)}`,
});

export const buildBoolJson = (
  ast: BooleanNode | null
): ManticoreBoolQuery | null => {
  if (ast === null) {
    return null;
  }

  switch (ast.kind) {
    case "term":
    case "phrase": {
      return { bool: { must: [clauseForNode(ast)] } };
    }
    case "not": {
      return { bool: { must_not: [clauseForNode(ast.operand)] } };
    }
    case "and": {
      return {
        bool: {
          must: ast.operands.map((operand) => clauseForNode(operand)),
        },
      };
    }
    case "or": {
      return {
        bool: {
          minimum_should_match: 1,
          should: ast.operands.map((operand) => clauseForNode(operand)),
        },
      };
    }
    default: {
      const _exhaustive: never = ast;
      throw new Error(`Unsupported boolean node: ${String(_exhaustive)}`);
    }
  }
};
