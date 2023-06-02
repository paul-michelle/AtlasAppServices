const cout = (msg) => void console.log(msg);
const client = context.services.get("mongodb-atlas");

exports = async changeEvent => {
  const insertedId = await client
    .db("sample_geospatial")
    .collection("changeEvents")
    .insertOne(changeEvent)
    .then(res => res.insertedId);

  cout(`A change to the collection has been saved as a document with _id ${insertedId}`);
};