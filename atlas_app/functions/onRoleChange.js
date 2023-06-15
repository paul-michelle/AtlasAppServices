const updateRule = async (collName, roleName, collRolePerms) => {
  console.log(collName, roleName, collRolePerms);
};

exports = async (changeEvent) => {
  const {fullDocument} = changeEvent;

  if (changeEvent.operationType === "update") {
    for (const key in changeEvent.updateDescription.updatedFields) {
      if (!key.startsWith("permissions")) continue;
      const collName = key.split(".")[1];
      const roleName = changeEvent.fullDocument.name;
      const collRolePerms = changeEvent.fullDocument.permissions[collName];
      await updateRule(collName, roleName, collRolePerms);
    }
    // console.log("updateDescription", JSON.stringify(changeEvent.updateDescription, null, 2));
  }
};
