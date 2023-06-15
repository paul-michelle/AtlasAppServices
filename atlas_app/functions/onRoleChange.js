exports = function(changeEvent) {
  const {fullDocument, operationType} = changeEvent;

  if (operationType === "update") {
    for (const key in changeEvent.updateDescription.updatedFields) {
      if (key.includes("permissions")) console.log("permissions have been updated");
    }
    console.log("role has beenupdated");
    console.log("fullDocument", JSON.stringify(fullDocument, null, 2));
    console.log("changeEvent", JSON.stringify(changeEvent, null, 2));
  }
};
