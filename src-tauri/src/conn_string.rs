use crate::db::ConnectionConfig;

fn split_connection_string_parts(conn_str: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;

    for ch in conn_str.chars() {
        match quote {
            Some(q) if ch == q => {
                quote = None;
                current.push(ch);
            }
            Some(_) => current.push(ch),
            None if ch == '\'' || ch == '"' => {
                quote = Some(ch);
                current.push(ch);
            }
            None if ch == ';' => {
                parts.push(current.trim().to_string());
                current.clear();
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() || conn_str.ends_with(';') {
        parts.push(current.trim().to_string());
    }

    parts
}

fn unquote_connection_string_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.chars().next();
        let last = trimmed.chars().last();
        if matches!(
            (first, last),
            (Some('"'), Some('"')) | (Some('\''), Some('\''))
        ) {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

pub fn parse_connection_string(conn_str: &str) -> Result<ConnectionConfig, String> {
    let mut config = ConnectionConfig::default();
    let mut pairs: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for part in split_connection_string_parts(conn_str) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((key, value)) = part.split_once('=') {
            pairs.insert(
                key.trim().to_lowercase(),
                unquote_connection_string_value(value),
            );
        }
    }

    let server = pairs
        .remove("server")
        .or_else(|| pairs.remove("data source"))
        .or_else(|| pairs.remove("addr"))
        .or_else(|| pairs.remove("address"))
        .or_else(|| pairs.remove("network address"))
        .or_else(|| pairs.remove("datasource"))
        .ok_or_else(|| {
            "Connection string must contain a 'Server' or 'Data Source' key".to_string()
        })?;

    config.server = if matches!(server.get(..4), Some(prefix) if prefix.eq_ignore_ascii_case("tcp:"))
    {
        server.get(4..).unwrap_or_default().to_string()
    } else {
        server
    };

    if let Some(port) = pairs.remove("port") {
        config.port = Some(
            port.parse::<u16>()
                .map_err(|e| format!("Invalid port '{}': {}", port, e))?,
        );
    }

    if let Some(db) = pairs
        .remove("database")
        .or_else(|| pairs.remove("initial catalog"))
        .or_else(|| pairs.remove("catalog"))
    {
        if !db.is_empty() {
            config.database = Some(db);
        }
    }

    let user = pairs
        .remove("user id")
        .or_else(|| pairs.remove("uid"))
        .or_else(|| pairs.remove("user"))
        .or_else(|| pairs.remove("username"));

    let pass = pairs.remove("password").or_else(|| pairs.remove("pwd"));

    let integrated = pairs
        .remove("integrated security")
        .or_else(|| pairs.remove("trusted_connection"))
        .or_else(|| pairs.remove("trusted"));

    let use_integrated = integrated
        .as_deref()
        .map(|v| {
            v.eq_ignore_ascii_case("sspi")
                || v.eq_ignore_ascii_case("true")
                || v.eq_ignore_ascii_case("yes")
                || v == "1"
        })
        .unwrap_or(false);

    if use_integrated {
        config.use_windows_auth = true;
    } else if let Some(u) = user {
        config.username = Some(u);
        config.password = pass;
    } else if let Some(p) = pass {
        config.username = Some(String::new());
        config.password = Some(p);
    }

    if let Some(encrypt) = pairs.remove("encrypt") {
        config.encrypt = encrypt.eq_ignore_ascii_case("true")
            || encrypt.eq_ignore_ascii_case("yes")
            || encrypt == "1"
            || encrypt.eq_ignore_ascii_case("mandatory")
            || encrypt.eq_ignore_ascii_case("strict");
    }

    if let Some(trust) = pairs
        .remove("trustservercertificate")
        .or_else(|| pairs.remove("trust server certificate"))
    {
        config.trust_server_certificate =
            trust.eq_ignore_ascii_case("true") || trust.eq_ignore_ascii_case("yes") || trust == "1";
    }

    config.connection_string = Some(conn_str.to_string());
    Ok(config)
}

pub fn strip_password_from_connection_string(conn_str: &str) -> String {
    split_connection_string_parts(conn_str)
        .into_iter()
        .filter_map(|part| {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                return None;
            }

            let key = trimmed
                .split_once('=')
                .map(|(key, _)| key.trim().to_ascii_lowercase());

            match key.as_deref() {
                Some("password") | Some("pwd") => None,
                _ => Some(trimmed.to_string()),
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_encrypt_aliases_used_by_sqlclient() {
        let mandatory =
            parse_connection_string("Server=localhost;Encrypt=Mandatory").expect("parse");
        let strict = parse_connection_string("Server=localhost;Encrypt=Strict").expect("parse");

        assert!(mandatory.encrypt);
        assert!(strict.encrypt);
    }

    #[test]
    fn strips_password_without_breaking_quoted_semicolons() {
        let stripped = strip_password_from_connection_string(
            "Server=localhost;Password='semi;colon';User ID=sa;Database=test",
        );

        assert_eq!(stripped, "Server=localhost;User ID=sa;Database=test");
    }
}
