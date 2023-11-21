import { readFile } from "fs/promises";

const fileContent = await readFile("featureFlags.json", "utf-8");
const featureFlags = JSON.parse(fileContent);
const featureManager = new FeatureManager(featureFlags);

// Is always true
console.log("Alpha is ", featureManager.isEnabled("Alpha"))
// Is always false
console.log("Beta is ", featureManager.isEnabled("Beta"))
// Is false 50% of the time
console.log("Gamma is ", featureManager.isEnabled("Gamma"))
// Is true between two dates
console.log("Delta is ", featureManager.isEnabled("Delta"))
// Is true After 06-27-2023
console.log("Sigma is ", featureManager.isEnabled("Sigma"))
// Is true Before 06-28-2023
console.log("Epsilon is ", featureManager.isEnabled("Epsilon"))
// Target is true for Adam, group Stage 1, and 50% of users
console.log("Target is ", featureManager.isEnabled("Target", { user: "Adam" }))
console.log("Target is ", featureManager.isEnabled("Target", { user: "Brian" }))