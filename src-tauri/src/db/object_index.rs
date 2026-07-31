use super::types::{
    DatabaseObject, ServerDatabaseObject, ServerObjectIndexStatus, ServerObjectSearchResponse,
};

#[derive(Debug, Clone, Default)]
pub struct CachedServerObjectIndex {
    pub initialized: bool,
    pub indexing: bool,
    pub database_count: usize,
    pub processed_database_count: usize,
    pub failed_databases: Vec<String>,
    objects: Vec<SearchableServerObject>,
}

#[derive(Debug, Clone)]
struct SearchableServerObject {
    object: ServerDatabaseObject,
    database_lower: String,
    schema_lower: String,
    name_lower: String,
    qualified_lower: String,
    database_qualified_lower: String,
    haystack_lower: String,
    type_rank: i32,
}

impl SearchableServerObject {
    fn new(database: String, object: DatabaseObject) -> Self {
        let database_lower = database.to_lowercase();
        let schema_lower = object.schema_name.to_lowercase();
        let name_lower = object.name.to_lowercase();
        let qualified_lower = format!("{}.{}", schema_lower, name_lower);
        let database_qualified_lower = format!("{}.{}", database_lower, qualified_lower);
        let haystack_lower = format!(
            "{} {} {} {} {}",
            database_lower,
            qualified_lower,
            name_lower,
            schema_lower,
            object_type_label(&object.object_type).to_lowercase()
        );
        let type_rank = object_type_rank(&object.object_type);

        Self {
            object: ServerDatabaseObject {
                database,
                name: object.name,
                schema_name: object.schema_name,
                object_type: object.object_type,
            },
            database_lower,
            schema_lower,
            name_lower,
            qualified_lower,
            database_qualified_lower,
            haystack_lower,
            type_rank,
        }
    }
}

impl CachedServerObjectIndex {
    pub fn start() -> Self {
        Self {
            initialized: true,
            indexing: true,
            ..Self::default()
        }
    }

    pub fn status(&self) -> ServerObjectIndexStatus {
        ServerObjectIndexStatus {
            initialized: self.initialized,
            indexing: self.indexing,
            database_count: self.database_count,
            processed_database_count: self.processed_database_count,
            failed_databases: self.failed_databases.clone(),
            object_count: self.objects.len(),
        }
    }

    pub fn set_database_count(&mut self, database_count: usize) {
        self.database_count = database_count;
    }

    pub fn add_database_objects(
        &mut self,
        database: String,
        database_objects: Vec<DatabaseObject>,
    ) {
        self.objects.extend(
            database_objects
                .into_iter()
                .map(|object| SearchableServerObject::new(database.clone(), object)),
        );
        self.processed_database_count += 1;
    }

    pub fn add_failed_database(&mut self, database: String) {
        self.failed_databases.push(database);
        self.processed_database_count += 1;
    }

    pub fn finish(&mut self) {
        self.indexing = false;
    }
}

fn object_type_label(object_type: &str) -> &'static str {
    match object_type {
        "TABLE" => "Table",
        "VIEW" => "View",
        "PROCEDURE" => "Procedure",
        "FUNCTION" => "Function",
        "TRIGGER" => "Trigger",
        "TYPE" => "Type",
        _ => "Object",
    }
}

fn object_type_rank(object_type: &str) -> i32 {
    match object_type {
        "TABLE" => 0,
        "VIEW" => 1,
        "PROCEDURE" => 2,
        "FUNCTION" => 3,
        "TRIGGER" => 4,
        "TYPE" => 5,
        _ => 99,
    }
}

fn get_object_search_score(
    object: &SearchableServerObject,
    terms: &[&str],
    preferred_database: Option<&str>,
) -> Option<i32> {
    let preferred_bonus = if preferred_database
        .map(|database| object.database_lower == database)
        .unwrap_or(false)
    {
        -20
    } else {
        0
    };

    if terms.is_empty() {
        return Some(object.type_rank + preferred_bonus);
    }

    let mut score = preferred_bonus;

    for term in terms {
        if term.is_empty() {
            continue;
        }

        if object.qualified_lower == *term
            || object.name_lower == *term
            || object.database_qualified_lower == *term
        {
            score -= 60;
            continue;
        }

        if object.name_lower.starts_with(term) {
            continue;
        }

        if object.qualified_lower.starts_with(term) {
            score += 8;
            continue;
        }

        if object.schema_lower.starts_with(term) {
            score += 16;
            continue;
        }

        if object.database_lower.starts_with(term) {
            score += 20;
            continue;
        }

        if let Some(index) = object.qualified_lower.find(term) {
            score += 28 + index as i32;
            continue;
        }

        if let Some(index) = object.haystack_lower.find(term) {
            score += 52 + index as i32;
            continue;
        }

        return None;
    }

    Some(score + object.type_rank)
}

pub fn search_server_objects(
    index: &CachedServerObjectIndex,
    query: &str,
    preferred_database: Option<&str>,
    object_type: Option<&str>,
    database_filter: Option<&str>,
    limit: usize,
) -> ServerObjectSearchResponse {
    let normalized_query = query.trim().to_lowercase();
    let terms: Vec<&str> = normalized_query
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect();
    let preferred_database = preferred_database.map(str::to_lowercase);
    let object_type_filter = object_type
        .map(str::to_uppercase)
        .filter(|value| !value.is_empty());
    let database_filter_value = database_filter
        .map(str::to_lowercase)
        .filter(|value| !value.is_empty());
    let mut ranked: Vec<(i32, &SearchableServerObject)> = Vec::new();

    for object in &index.objects {
        if let Some(filter) = object_type_filter.as_deref() {
            if object.object.object_type != filter {
                continue;
            }
        }
        if let Some(filter) = database_filter_value.as_deref() {
            if object.database_lower != filter {
                continue;
            }
        }
        if let Some(score) = get_object_search_score(object, &terms, preferred_database.as_deref())
        {
            ranked.push((score, object));
        }
    }

    ranked.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.type_rank.cmp(&right.1.type_rank))
            .then(left.1.object.database.cmp(&right.1.object.database))
            .then(left.1.object.schema_name.cmp(&right.1.object.schema_name))
            .then(left.1.object.name.cmp(&right.1.object.name))
    });

    let total_matches = ranked.len();
    let results = ranked
        .into_iter()
        .take(limit)
        .map(|(_, object)| object.object.clone())
        .collect();

    ServerObjectSearchResponse {
        results,
        total_matches,
        initialized: index.initialized,
        indexing: index.indexing,
        database_count: index.database_count,
        processed_database_count: index.processed_database_count,
        failed_databases: index.failed_databases.clone(),
    }
}
