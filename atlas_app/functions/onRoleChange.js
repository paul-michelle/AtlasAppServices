

let config;

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

const transport = {
    post: async ({ url, body, headers = {} }) => context.http
        .post({ url, body, headers, encodeBodyAsJSON: true })
        .then(resp => resp.body.text())
        .then(JSON.parse),
    put: async ({ url, body, headers = {} }) => context.http
        .put({ url, body, headers, encodeBodyAsJSON: true })
        .then(resp => resp.body.text())
        .then(JSON.parse),
    get: async ({ url, headers = {} }) => context.http
        .get({ url, headers })
        .then(resp => resp.body.text())
        .then(JSON.parse),
    delete: async ({ url, headers = {} }) => context.http
        .delete({ url, headers })
        .then(resp => resp.body.text())
        .then(JSON.parse),
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

const adminLogin = async (username = '', apiKey = '') => {
    const url = config.ADMIN_API.LOGIN;
    const body = {
        username: username || config.ADMIN_PUBLIC_API_KEY,
        apiKey: apiKey || config.ADMIN_PRIVATE_API_KEY
    };
    return transport.post({ url, body });
};

const getAllRules = async (token = '') => {
    if (token === '') {
        const { access_token } = await adminLogin();
        token = access_token;
    }
    return transport.get({
        url: config.ADMIN_API.RULES,
        headers: { "Authorization": [`Bearer ${token}`] }
    });
};

const getRuleId = async (collName, token) => {
    const rules = await getAllRules(token);
    if (!rules) return -1;
    const rule = rules.filter(
        rule => rule.database === config.DATABASE && rule.collection === collName
    )[0];
    if (!rule) return -1;
    return rule._id || -1;
};

const getRuleById = async (ruleId, token) => {
    const url = `${config.ADMIN_API.RULES}/${ruleId}`;
    const headers = { "Authorization": [`Bearer ${token}`] };
    const resp = await transport.get({ url, headers });
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

const insertRule = async (rule, token = '') => {
    if (token === '') {
        const { access_token } = await adminLogin();
        token = access_token;
    }
    const resp = await transport.post({
        url: config.ADMIN_API.RULES,
        body: rule,
        headers: { "Authorization": [`Bearer ${token}`] },
    });
    return resp;
};

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

const saveRule = async (rule, token = '') => {
    if (token === '') {
        const { access_token } = await adminLogin();
        token = access_token;
    }
    const url = `${config.ADMIN_API.RULES}/${rule._id}`;
    const headers = { "Authorization": [`Bearer ${token}`] };
    const resp = await transport.put({ url, body: rule, headers });
    console.log(JSON.stringify(resp));
    return resp;
};

const deleteRule = async ({ _id }, token = '') => {
    if (token === '') {
        const { access_token } = await adminLogin();
        token = access_token;
    }
    const url = `${config.ADMIN_API.RULES}/${_id}`;
    const headers = { "Authorization": [`Bearer ${token}`] };
    const resp = await transport.delete({ url, headers });
    return resp;
};

const updateRule = async (collName, roleName, collRolePerms, upsert = true) => {
    const insertRuleOrReportThat = async msg => {
        if (!upsert) return { result: msg };
        const role = buildRole(roleName, collRolePerms);
        const newRule = buildRule([role], collName);
        const result = await insertRule(newRule, token);
        return { result };
    };
    const { access_token: token } = await adminLogin();
    const ruleId = await getRuleId(collName, token);
    if (ruleId === -1) return insertRuleOrReportThat("rule not found");
    const rule = await getRuleById(ruleId, token);
    if (rule === null) return insertRuleOrReportThat("rule was deleted");
    const updatedRule = updateRoleInRule(rule, roleName, collRolePerms);
    const action = utils.isEmpty(updatedRule.roles) ? deleteRule : saveRule;
    const result = await action(updatedRule, token);
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
        if (!key.startsWith("permissions")) continue;
        const collName = key.split(".")[1];
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
    console.log(`dispatching change event to ${handler.name} handler`);
    const res = await handler(changeEvent);
    console.log(`response from handler: ${utils.toString(res)}`);
    return res;
};