pub fn split_batches(sql: &str) -> Vec<String> {
    let mut batches = Vec::new();
    let mut current_batch = String::new();
    let mut in_block_comment = false;

    for line in sql.lines() {
        if in_block_comment {
            in_block_comment = update_block_comment_state(line, true);
            if !current_batch.is_empty() {
                current_batch.push('\n');
            }
            current_batch.push_str(line);
            continue;
        }

        let trimmed = line.trim();

        let go_prefix = trimmed.get(..2);
        let go_suffix = trimmed.get(2..).unwrap_or("");
        let is_go = go_prefix.is_some_and(|p| p.eq_ignore_ascii_case("go")) && {
            let after_go = go_suffix.trim();
            after_go.is_empty() || after_go.bytes().all(|b| b.is_ascii_digit())
        };

        if is_go {
            if !current_batch.trim().is_empty() {
                let repeat: usize = go_suffix.trim().parse().unwrap_or(1).max(1);
                for _ in 0..repeat {
                    batches.push(current_batch.clone());
                }
            }
            current_batch = String::new();
        } else {
            if !current_batch.is_empty() {
                current_batch.push('\n');
            }
            current_batch.push_str(line);
            in_block_comment = update_block_comment_state(line, false);
        }
    }
    if !current_batch.trim().is_empty() {
        batches.push(current_batch);
    }
    batches
}

fn update_block_comment_state(line: &str, mut in_block: bool) -> bool {
    let bytes = line.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut in_string = false;
    let mut in_quoted_ident = false;

    while i < len {
        let b = bytes[i];

        if in_block {
            if i + 1 < len && b == b'*' && bytes[i + 1] == b'/' {
                in_block = false;
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }

        if in_string {
            if b == b'\'' {
                if i + 1 < len && bytes[i + 1] == b'\'' {
                    i += 2;
                } else {
                    in_string = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }

        if in_quoted_ident {
            if b == b']' {
                if i + 1 < len && bytes[i + 1] == b']' {
                    i += 2;
                } else {
                    in_quoted_ident = false;
                    i += 1;
                }
            } else {
                i += 1;
            }
            continue;
        }

        if i + 1 < len && b == b'-' && bytes[i + 1] == b'-' {
            return in_block;
        }
        if i + 1 < len && b == b'/' && bytes[i + 1] == b'*' {
            in_block = true;
            i += 2;
            continue;
        }
        if b == b'\'' {
            in_string = true;
            i += 1;
            continue;
        }
        if b == b'[' {
            in_quoted_ident = true;
            i += 1;
            continue;
        }
        i += 1;
    }
    in_block
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_state_simple_open_close_on_one_line() {
        assert!(!update_block_comment_state("SELECT /* hi */ 1", false));
    }

    #[test]
    fn block_state_open_close_then_reopen_on_one_line() {
        assert!(update_block_comment_state("/* a */ b /*", false));
    }

    #[test]
    fn block_state_multiple_close_open_pairs() {
        assert!(update_block_comment_state("/* a */ b */ c /*", false));
        assert!(!update_block_comment_state("/* a */ /* b */", false));
    }

    #[test]
    fn block_state_ignores_block_markers_inside_strings() {
        assert!(!update_block_comment_state("SELECT 'a /* b' FROM t", false));
        assert!(!update_block_comment_state("SELECT 'a */ b' FROM t", false));
    }

    #[test]
    fn block_state_ignores_block_markers_inside_quoted_idents() {
        assert!(!update_block_comment_state("SELECT [a /* b] FROM t", false));
    }

    #[test]
    fn block_state_line_comment_freezes_state() {
        assert!(!update_block_comment_state("SELECT 1 -- /* nope", false));
        assert!(update_block_comment_state(
            "still in block -- not a line comment here",
            true
        ));
    }

    #[test]
    fn split_batches_handles_go_with_repeat() {
        let sql = "SELECT 1\nGO 3";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 3);
        for b in &batches {
            assert!(b.contains("SELECT 1"));
        }
    }

    #[test]
    fn split_batches_skips_go_inside_block_comment() {
        let sql = "SELECT 1\n/* a\nGO\nb */\nSELECT 2";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 1);
        assert!(batches[0].contains("SELECT 1"));
        assert!(batches[0].contains("SELECT 2"));
        assert!(batches[0].contains("/* a"));
    }

    #[test]
    fn split_batches_handles_close_then_reopen_on_same_line() {
        let sql = "/* first */ SELECT 1 /*\nGO\nstill in block */\nGO\nSELECT 2";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 2);
        assert!(batches[0].contains("SELECT 1"));
        assert!(batches[1].contains("SELECT 2"));
    }

    #[test]
    fn split_batches_does_not_treat_go_in_string_as_separator() {
        let sql = "SELECT 'GO'\nSELECT 1";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 1);
    }

    #[test]
    fn split_batches_does_not_panic_on_multibyte_leading_char() {
        let sql = "中文 SELECT 1\nGO\nSELECT 2";
        let batches = split_batches(sql);
        assert_eq!(batches.len(), 2);
    }
}
