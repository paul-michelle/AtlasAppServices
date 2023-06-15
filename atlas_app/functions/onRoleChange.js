exports = function(changeEvent) {
  const {fullDocument} = changeEvent;

  if (changeEvent.operationType === "update") {
    for (const key in changeEvent.updateDescription.updatedFields) {
      if (!key.includes("permissions")) continue;
      const perms = changeEvent.fullDocument.permissions;
      console.log(perms);
      
    }
    console.log("updateDescription", JSON.stringify(changeEvent.updateDescription, null, 2));
  }
};
