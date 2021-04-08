const remark_retext = require("remark-retext");
const retext_english = require("retext-english");
const retext_stringify = require("retext-stringify");
const unist_modify_children = require("unist-util-modify-children");
const unist_visit_parents = require("unist-util-visit-parents");
const unist_position = require("unist-util-position");
const unist_filter = require("unist-util-filter");
const unist_remove = require("unist-util-remove");
const unist_visit = require("unist-util-visit");
const unist_is = require("unist-util-is");
const unified = require("unified");

const are_all_int = (a) => {
  // Also handles null, undefined, NaN, '', {}, etc
  return a.every((x) => Math.round(x) === x);
}

const is_within = ([start, end], [_start, _end]) => {
  if (!are_all_int([_start, start, end, _end])) {
    return false;
  }
  // is _start, _end within start, end?
  return _start >= start && _end <= end;
};

const is_node_within = ([start, end], _node) => {
  const _node_position = unist_position(_node);
  const _start = _node_position.start.offset;
  const _end = _node_position.end.offset;
  // is node within start, end?
  return is_within([start, end], [_start, _end]);
}

const is_overlap = ([start, end], [_start, _end]) => {
  if (!are_all_int([_start, start, end, _end])) {
    return false;
  }
  return _start < end && start < _end;
};

const is_overlap_node = ([start, end], _node) => {
  const _node_position = unist_position(_node);
  const _start = _node_position.start.offset;
  const _end = _node_position.end.offset;
  return is_overlap([start, end], [_start, _end]);
};

const is_overlap_nodes = (node, _node) => {
  const node_position = unist_position(node);
  const start = node_position.start.offset;
  const end = node_position.end.offset;
  const _node_position = unist_position(_node);
  const _start = _node_position.start.offset;
  const _end = _node_position.end.offset;
  return is_overlap([start, end], [_start, _end]);
};

const match_tree_literals = (tree, offsets=[], annotate=false, options=null) => {
  const literals = [];
  if (!tree) {
    return literals;
  }
  unist_visit_parents(tree, (node, ancestors) => {
    const is_literal = node.value != null;
    if (!is_literal) {
      return;
    }
    let should_push = true;
    if (offsets.length) {
      should_push = is_overlap_node(offsets, node);
    }
    if (should_push) {
      literals.push({
        ancestors,
        node
      });
    }
  });
  return literals;
};

const extract_fixes = (mdast_tree, options) => {
  let fixes = [];
  const accepted = [
    "retext-spell",
    "retext-quotes",
    "retext-diacritics",
    "retext-contractions",
    "retext-repeated-words",
    "retext-sentence-spacing",
    "retext-indefinite-article",
    "retext-redundant-acronyms"
  ];
  const mdast_position = unist_position(mdast_tree);
  const min_start = mdast_position.start.offset;
  const max_end = mdast_position.end.offset;

  const { file, fixers } = options;
  Object.keys(fixers).forEach((key) => {
    accepted.push(key);
  });
  const default_fixer = ({expected}) => {
    return (expected && expected.length)? expected[0] : null;
  }
  const copySpellMap = new Map();
  file.messages.forEach((message) => {
    if (accepted.includes(message.source)) {
      const fixer = fixers[message.source] || default_fixer;
      let [start, end, only_expected] = [
        message.location.start.offset,
        message.location.end.offset,
        fixer(message)
      ];
      // Handle duplicate mispellings lacking expected values
      if (message.source === "retext-spell") {
        if (only_expected) {
          copySpellMap.set(message.actual, only_expected);
        } else {
          only_expected = copySpellMap.get(message.actual);
        }
      }
      // Filter messages in relevant nodes
      if (start < min_start || end > max_end) {
        return;
      }
      if ([start, end, only_expected].every((v) => v != null)) {
        fixes.push({
          actual: message.actual,
          expected: [only_expected],
          start,
          end
        });
      }
    }
  });
  // Sort fixes from first to last
  fixes = fixes.sort((fix_a, fix_b) => {
    return Math.sign(fix_a.start - fix_b.start);
  })
  // Merge fixes with overlapping locations
  fixes = fixes.reduce((merged_fixes, fix) => {
    if (merged_fixes.length) {
      const top_fix = merged_fixes[merged_fixes.length - 1];
      const top_overlap = is_overlap(
        [top_fix.start, top_fix.end],
        [fix.start, fix.end]
      );
      if (top_overlap) {
        top_fix.end = Math.max(top_fix.end, fix.end);
        // Replace existing expected values fixed by current fix
        top_fix.expected = top_fix.expected.map((expected) => {
          return (fix.actual === expected)? fix.expected[0] : expected;
        })
        // Only track fixes with new expected values
        if (!top_fix.expected.includes(fix.expected[0])) {
          top_fix.expected.push(fix.expected[0]);
          if (top_fix.start == fix.start) {
            top_fix.n_same_start += 1;
          }
        }
        return merged_fixes;
      }
    }
    delete fix.actual;
    merged_fixes.push({
      ...fix,
      n_same_start: 1,
    });
    return merged_fixes;
  }, []);
  // Add mdast list with deletions
  fixes = fixes.map((fix) => {
    const { start, end } = fix;
    const mdast_list = match_tree_literals(mdast_tree, [start, end], true, options);
    return {
      ...fix,
      mdast_list
    };
  });
  return fixes;
};

const longest_common_substring = (s1, s2) => {
  const n_row = s1.length + 1;
  const n_col = s2.length + 1;
  const table = new Int16Array(n_row * n_col).fill(0);
  const t_i = (r, c) => r * n_col + c;

  let longest = 0;
  for (let r = 1; r < n_row; r++) {
    for (let c = 1; c < n_col; c++) {
      if (s1[r - 1] === s2[c - 1]) {
        table[t_i(r, c)] = table[t_i(r - 1, c - 1)] + 1;
        longest = Math.max(table[t_i(r, c)], longest);
      }
    }
  }
  return longest;
}

const select_expected = (expected, n_same_start, old_text) => {
  // Use first expected value if one definitve first expected value
  if (n_same_start <= 1) {
    return expected[0] || '';
  }
  /* Use expected value with longest common substring in source text
     in case of multiple values with the same start */
  const same_start_expected = expected.slice(0, n_same_start);
  return same_start_expected.sort((a, b) => {
    return (
      longest_common_substring(old_text, b) -
      longest_common_substring(old_text, a)
    );
  })[0] || '';
  return only_expected;
}

const nlcst_validate_child = (node, parent) => {
  const parent_is_sentence = () => unist_is(parent, "SentenceNode");
  const is_space = () => unist_is(node, "WhiteSpaceNode");
  return parent_is_sentence() || is_space();
}

const nlcst_modify_parents = (tree, modifier) => {
  ["SentenceNode", "ParagraphNode", "RootNode"].forEach((type) => {
    unist_visit(tree, type, (node) => {
      unist_modify_children((n, i, p) => {
        if (nlcst_validate_child(n, p)) {
          modifier(p);
          return Infinity;
        }
        return i + 1;
      })(node);
    });
  });
}

const nlcst_label_parents = (tree) => {
  let id = 0;
  nlcst_modify_parents(tree, (parent) => {
    id ++;
    parent._id = id;
  });
}

const nlcst_to_children_map = (tree) => {
  const childrenMap = new Map();
  if (!tree) {
    return childrenMap;
  }
  nlcst_modify_parents(tree, (parent) => {
    const id = parent._id || 0;
    childrenMap.set(id, parent.children);
  });
  return childrenMap;
};

const text_to_nlcst = unified().use(retext_english);
const nlcst_to_text = unified().use(retext_stringify);

const text_to_children = (str) => {
  // Treat this tree as if it only has one parent
  const tree = text_to_nlcst.runSync(text_to_nlcst.parse(str));
  return [].concat(...nlcst_to_children_map(tree).values());
}

const fix_to_expected = (fix, tree) => {
  const {expected, n_same_start} = fix;
  let old_text = '';
  if (tree != null) {
    old_text = nlcst_to_text.stringify(tree);
  }
  return select_expected(expected, n_same_start, old_text);
}

const apply_fix = (fix, tree, old_children_map, new_children) => {
  const every_new_leaf = new_children.every(v => v.value != null);
  const cannot_replace_children = (node) => {
    return !every_new_leaf || !node.children;
  };
  const is_overlap_fix = (node) => {
    return is_overlap_node([fix.start, fix.end], node);
  };
  const is_in_fix = (node) => {
    return is_node_within([fix.start, fix.end], node);
  };
  let fixed = false;

  nlcst_modify_parents(tree, (parent) => {
    if (old_children_map.has(parent._id)) {
      const old_children = old_children_map.get(parent._id);
      parent.children = parent.children.reduce((all_nodes, node) => {
        if (is_overlap_fix(node)) {
          // Remove the entire node
          if (fixed) {
            return all_nodes;
          }
          // Replace the entire node
          if (is_in_fix(node) || cannot_replace_children(node)) {
            fixed = true;
            return all_nodes.concat(new_children);
          }
          // Replace only some children
          node.children = node.children.reduce((child_nodes, child) => {
            if (is_overlap_fix(child)) {
              // Remove the child
              if (fixed) {
                return child_nodes;
              }
              // Replace the child
              fixed = true;
              return child_nodes.concat(new_children);
            }
            return child_nodes.concat([child]);
          }, []);
          return all_nodes.concat([node]);
        }
        return all_nodes.concat([node]);
      }, []);
    }
  });
}

const check_fixes = (fixes, nlcst_tree, options) => {
  const treeMap = new Map();
  fixes.forEach((fix) => {
    const { mdast_list } = fix;
    let max_depth = Math.max(...mdast_list.map((v) => v.ancestors.length));
    const fix_subtree = unist_filter(nlcst_tree, (node) => {
      return is_overlap_node([fix.start, fix.end], node);
    });
    const expected = fix_to_expected(fix, fix_subtree);
    const old_children_map = nlcst_to_children_map(fix_subtree);
    const expected_children = text_to_children(expected);
    mdast_list.forEach((v) => {
      let new_children = [];
      let subtree = treeMap.get(v.node);
      if (!subtree) {
        subtree = unist_filter(nlcst_tree, (node) => {
          return is_overlap_nodes(v.node, node);
        });
      }
      if (v.ancestors.length >= max_depth) {
        new_children = expected_children;
        max_depth = Infinity;
      }
      apply_fix(fix, subtree, old_children_map, new_children);
      treeMap.set(v.node, subtree);
    });
  });

  const fixMap = new Map();
  treeMap.forEach((subtree, node) => {
    fixMap.set(node, nlcst_to_text.stringify(subtree));
  });

  return fixMap;
};

const p_to_nlcst = unified().use(remark_retext, retext_english.Parser);

const mdast_handler = (mdast_tree, options) => {
  const fixes = extract_fixes(mdast_tree, options);
  let fixMap = new Map();
  p_to_nlcst()
    .use(() => {
      return (nlcst_tree, _) => {
        nlcst_label_parents(nlcst_tree);
        fixMap = check_fixes(fixes, nlcst_tree, options);
      };
    })
    .runSync(mdast_tree, options.file);
  // Apply all the fixes to all of the mdast nodes
  unist_visit(mdast_tree, (node) => {
    const is_literal = node.value != null;
    if (!is_literal) {
      return node;
    }
    if (fixMap.has(node)) {
      node.value = fixMap.get(node);
    }
    return node;
  })
  // Removes all empty literal nodes
  // Such as when *dup* *dup* -> *dup* **
  unist_remove(mdast_tree, (node) => {
    const is_literal = node.value != null;
    if (!is_literal) {
      return false;
    }
    return node.value === "";
  });
};

function remark_autofix (options) {
  return (tree, file) => {
    unist_visit(tree, 'heading', (h) => {
      mdast_handler(h, {
        fixers: {},
        ...options, file
      });
    });
    unist_visit(tree, 'paragraph', (p) => {
      mdast_handler(p, {
        fixers: {},
        ...options, file
      });
    });
    return tree;
  };
};

module.exports = remark_autofix;
