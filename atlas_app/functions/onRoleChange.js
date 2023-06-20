let config;
let httpClient;

const buildConfig = async () => {
    const config = {
        ADMIN_API: {
            PREFIX: "https://realm.mongodb.com/api/admin/v3.0",
        },
        ADMIN_PUBLIC_API_KEY: context.values.get("adminApiPublicKey") || "pqzcfcsd",
        ADMIN_PRIVATE_API_KEY: context.values.get("adminApiPrivateKey") || "cdeb5d02-f277-4f3c-85e5-6bdd75a28a72",
        DATABASE: context.values.get("database") || "sample_airbnb",
        GROUP_ID: context.values.get("groupId") || "642ac3c26213b9459913342c",
        APP_ID: context.values.get("appId") || "6478cc03097661a032bbe504",
        SERVICE_ID: context.values.get("serviceId") || "6478e9c993710a7bd36d57b5",
    };
    config.ADMIN_API.RULES = `${config.ADMIN_API.PREFIX}/groups/${config.GROUP_ID}/apps/${config.APP_ID}/services/${config.SERVICE_ID}/rules`;
    config.ADMIN_API.LOGIN = `${config.ADMIN_API.PREFIX}/auth/providers/mongodb-cloud/login`;
    return config;
};

const buildHttpClient = async () => {
    const parse = resp => JSON.parse(resp.body.text());
    const adminLogin = async () => {
        const url = config.ADMIN_API.LOGIN;
        const body = {
            username: config.ADMIN_PUBLIC_API_KEY,
            apiKey: config.ADMIN_PRIVATE_API_KEY
        };
        return context.http.post({ url, body, encodeBodyAsJSON: true }).then(parse);
    };
    const { access_token: tkn } = await adminLogin();
    const withAuth = headers => (headers.Authorization = [`Bearer ${tkn}`], headers);
    const client = {
        post: async (url, body, headers = {}) => context.http
            .post({ url, body, headers: withAuth(headers), encodeBodyAsJSON: true })
            .then(parse),
        put: async (url, body, headers = {}) => context.http
            .put({ url, body, headers: withAuth(headers), encodeBodyAsJSON: true })
            .then(parse),
        get: async (url, headers = {}) => context.http
            .get({ url, headers: withAuth(headers) })
            .then(parse),
        delete: async (url, headers = {}) => context.http
            .delete({ url, headers: withAuth(headers) })
            .then(parse),
    };
    return client;
};

const utils = {
    toString: o => JSON.stringify(o),
    isEmpty: o => {
        if (typeof o === "string") return o === "";
        if (Array.isArray(o)) return o.length === 0;
        if (typeof o === "object") return Object.keys(o).length === 0;
        throw new Error("not supported");
    },
};

const getRuleId = async collName => {
    const rules = await httpClient.get(config.ADMIN_API.RULES);
    if (!rules) return -1;
    const rule = rules.filter(
        rule => rule.database === config.DATABASE && rule.collection === collName
    )[0];
    if (!rule) return -1;
    return rule._id || -1;
};

const getRuleById = async ruleId => {
    const url = `${config.ADMIN_API.RULES}/${ruleId}`;
    const resp = await httpClient.get(url);
    return resp.error ? null : resp;
};

const updateRolePerms = (role, collRolePerms) => {
    const can = (p) => collRolePerms.includes(p);
    const docLevelRead = can("read") || can("search");
    const docLevelWrite = can("write") || can("insert") || can("delete");
    role.document_filters = {
        read: docLevelRead,
        write: docLevelWrite,
    };
    const rootLevelPerms = ["search", "read", "write", "insert", "delete"];
    for (const perm of rootLevelPerms) role[perm] = can(perm);
};

const buildRole = (roleName, collRolePerms) => {
    const role = {
        name: roleName,
        apply_when: {
            "%%user.custom_data.role": roleName,
        }
    };
    updateRolePerms(role, collRolePerms);
    return role;
};

const buildRule = (roles, collection, database = config.DATABASE) => ({ roles, database, collection });

const insertRule = async rule => httpClient.post(config.ADMIN_API.RULES, rule);

const updateRoleInRule = (rule, roleName, collRolePerms) => {
    rule.roles = rule.roles || [];

    const roleShouldBeRemoved = collRolePerms === undefined;
    if (roleShouldBeRemoved) {
        rule.roles = rule.roles.filter(role => role.name !== roleName);
        return rule;
    }

    const roleInRule = rule.roles.filter(role => role.name === roleName)[0];

    const roleShouldBeCreated = roleInRule === undefined;
    if (roleShouldBeCreated) {
        const newRole = buildRole(roleName, collRolePerms);
        rule.roles.push(newRole);
        return rule;
    }

    updateRolePerms(roleInRule, collRolePerms);
    return rule;
};

const saveRule = async rule => httpClient.put(`${config.ADMIN_API.RULES}/${rule._id}`, rule)

const deleteRule = async ({ _id }) => httpClient.delete(`${config.ADMIN_API.RULES}/${_id}`);

const updateRule = async (collName, roleName, collRolePerms, upsert = true) => {
    const insertRuleOrReportThat = async msg => {
        if (!upsert) return { result: msg };
        const role = buildRole(roleName, collRolePerms);
        const newRule = buildRule([role], collName);
        const result = await insertRule(newRule);
        return { result };
    };
    const ruleId = await getRuleId(collName);
    if (ruleId === -1) return insertRuleOrReportThat("rule not found");
    const rule = await getRuleById(ruleId);
    if (rule === null) return insertRuleOrReportThat("rule was deleted");
    const updatedRule = updateRoleInRule(rule, roleName, collRolePerms);
    const action = utils.isEmpty(updatedRule.roles) ? deleteRule : saveRule;
    const result = await action(updatedRule);
    return { result };
};

const onRoleInsert = async changeEvent => {
    const { name: roleName, permissions } = changeEvent.fullDocument;
    if (!roleName) return { roleName: "not found in role document" };
    if (!permissions) return { roleName, collRolePerms: "not specified in role document" };

    const tasks = [];

    for (const [collName, collRolePerms] of Object.entries(permissions)) {
        const task = updateRule(collName, roleName, collRolePerms)
            .then(res => ({ collName, roleName, ...res }))
            .catch(err => ({ collName, roleName, result: err }));
        tasks.push(task);
    }

    return Promise.all(tasks);
};

const onRoleUpdate = async changeEvent => {
    const { name: roleName } = changeEvent.fullDocument;
    if (!roleName) return { roleName: "not found in role document" };

    const tasks = [];

    for (const key in changeEvent.updateDescription.updatedFields) {
        console.log(`processing updated field: ${key}`);
        if (!key.startsWith("permissions")) continue;
        const collName = key.split(".")[1];
        if (collName === undefined) continue;
        const collRolePerms = changeEvent.fullDocument.permissions[collName];
        const task = updateRule(collName, roleName, collRolePerms)
            .then(res => ({ collName, roleName, ...res }))
            .catch(err => ({ collName, roleName, result: err }));
        tasks.push(task);
    }

    return Promise.all(tasks);
};

const onRoleDelete = async changeEvent => {
    const { name: roleName, permissions } = changeEvent.fullDocumentBeforeChange;
    if (!roleName) return { roleName: "not found in role document" };
    if (!permissions) return { roleName, collRolePerms: "not specified in role document" };

    const tasks = [];

    for (const collName in permissions) {
        const task = updateRule(collName, roleName, undefined)
            .then(res => ({ collName, roleName, ...res }))
            .catch(err => ({ collName, roleName, result: err }));
        tasks.push(task);
    }

    return Promise.all(tasks);
};

const onRoleReplace = async changeEvent => {
    const accumResults = [];
    if (changeEvent.fullDocumentBeforeChange.name !== changeEvent.fullDocument.name) {
        const deletionResults = await onRoleDelete(changeEvent);
        accumResults.push(...deletionResults);
    }
    const insertionResults = await onRoleInsert(changeEvent);
    accumResults.push(...insertionResults);
    return accumResults;
};

const handlers = {
    "insert": onRoleInsert,
    "update": onRoleUpdate,
    "delete": onRoleDelete,
    "replace": onRoleReplace,
};

exports = async changeEvent => {
    const handler = handlers[changeEvent.operationType];
    if (!handler) throw new Error("not supported");
    config = await buildConfig();
    httpClient = await buildHttpClient();
    console.log(`dispatching change event to ${handler.name} handler`);
    const res = await handler(changeEvent);
    console.log(`response from handler: ${utils.toString(res)}`);
    return res;
};

/** Testcases:

INSERT

1) INSERT new role without name:
    [
    "dispatching change event to onRoleInsert handler",
    "response from handler: {\"roleName\":\"not found in role document\"}"
    ]

2.1) INSERT new role with name without permissions:
    [
    "dispatching change event to onRoleInsert handler",
    "response from handler: {\"roleName\":\"Homeowner\",\"collRolePerms\":\"not specified in role document\"}"
    ]

2.2) INSERT new role with empty permissions:
    [
    "dispatching change event to onRoleInsert handler",
    "response from handler: []"
    ]

3) INSERT new role with name and some permissions for collection that does NOT exist (Homeowner, can read activities) ...
    [
    "dispatching change event to onRoleInsert handler",
    "response from handler: [{\"collName\":\"collThatDoesNotExists\",\"roleName\":\"Homeowner\",\"result\":{\"_id\":\"64907ba0b4552e3290dd1218\",\"database\":\"SMARTRoofDB",\"collection\":\"collThatDoesNotExists\"}}]"
    ]

    ... i.e. the rule will be created, though collection is not there.
 
4) INSERT new role with name and some permissions for collection that DOES exist:
    [
    "dispatching change event to onRoleInsert handler",
    "response from handler: [{\"collName\":\"activities\",\"roleName\":\"Homeowner\",\"result\":{\"_id\":\"64908be03224975901b8fe9e\",\"database\":\"SMARTRoofDB\",\"collection\":\"activities\"}}]"
    ]

5) INSERT new role with perms for numerous collections:
    [
        "dispatching change event to onRoleInsert handler",
        "response from handler: [
            {\"collName\":\"lead\",\"roleName\":\"Home21323\",\"result\":{\"_id\":\"6490b9f49e288478370379f2\",\"database\":\"SMARTRoofDB\",\"collection\":\"lead\"}},
            {\"collName\":\"activity\",\"roleName\":\"Home21323\",\"result\":{\"_id\":\"6490b9f49e288478370379f6\",\"database\":\"v\",\"collection\":\"activity\"}},
            {\"collName\":\"order\",\"roleName\":\"Home21323\",\"result\":{\"_id\":\"6490b9f4663180e2582b32b8\",\"database\":\"SMARTRoofDB\",\"collection\":\"order\"}}
        ]"
    ]
6) INSERT new role with empty array of perms, e.g. { name: "Homeowner", permissions: { activities: [] } } ...
    [
    "dispatching change event to onRoleInsert handler",
    "response from handler: [{\"collName\":\"activities\",\"roleName\":\"Homeowner\",\"result\":{}}]"
    ]

    ... will result in the following role {
      "name": "Homeowner",
      "apply_when": {
        "%%user.custom_data.role": "Homeowner"
      },
      "document_filters": {
        "write": false,
        "read": false
      },
      "read": false,
      "write": false,
      "insert": false,
      "delete": false,
      "search": false
    }

DELETE

1) DELETE role without name:
    [
    "dispatching change event to onRoleDelete handler",
    "response from handler: {\"roleName\":\"not found in role document\"}"
    ]

2) DELETE role without permissions:
    [
    "dispatching change event to onRoleDelete handler",
    "response from handler: {\"roleName\":\"Homeowner\",\"collRolePerms\":\"not specified in role document\"}"
    ]

3) DELETE role with name and some permissions for collection that does NOT exist:
    [
    "dispatching change event to onRoleDelete handler",
    "response from handler: [{\"collName\":\"collThatDoesNotExists\",\"roleName\":\"Homeowner\",\"result\":{}}]"
    ]

  The role gets deleted and, if it was the only one for this rule, rule gets deleted too.

4) DELETE role for collection that DOES exist:
    [
    "dispatching change event to onRoleDelete handler",
    "response from handler: [{\"collName\":\"collThatDoesNotExists\",\"roleName\":\"Homeowner\",\"result\":{}}]"
    ]

5) DELETE role with perms on numerous collections:
    [
        "dispatching change event to onRoleDelete handler",
        "response from handler: [
            {\"collName\":\"lead\",\"roleName\":\"Home21323\",\"result\":{}},
            {\"collName\":\"activity\",\"roleName\":\"Home21323\",\"result\":{}},
            {\"collName\":\"order\",\"roleName\":\"Home21323\",\"result\":{}}
        ]"
    ]


UPDATE
1) ADD permission to role without permissions field:

REPLACE

*/