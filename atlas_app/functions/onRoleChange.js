exports = function(changeEvent) {
  const {fullDocument, operationType} = changeEvent;

  if (operationType === "update") {
    for (const key of changeEvent.updateDescription.updatedFields) {
      console.log(key);
    }
    console.log("role has beenupdated");
    console.log("fullDocument", JSON.stringify(fullDocument, null, 2));
    console.log("changeEvent", JSON.stringify(changeEvent, null, 2));
  }
};
