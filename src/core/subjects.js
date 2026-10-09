// Subject registry (GeoQuiz's subjects.js): what a game or Explore is about.
// Each subject says how to load its items, which attributes it offers as
// question and answer, and how an item belongs to a region.
//
// - bones: the skeleton (public/data/skeleton.json).
// - attachments: muscle origins and insertions (public/data/insertions.json),
//   one item per muscle and role ("Biceps brachii muscle — insertion"),
//   found by clicking its patch on the skeleton. The bones are a solid,
//   unclickable backdrop. An attachment is in a region when any of its
//   patches sits on a bone in that region.
// - muscles: the muscles (public/data/muscles.json), one item per atlas
//   muscle or muscle part ("Acromial part of deltoid muscle"), asked like
//   bones. Their regions are their own tree, from the atlas's muscle groups
//   (regions.js muscleRegions); the bones they lie on are a solid backdrop.
//
// `regions` is the region tree the wizard offers and the game looks the
// chosen region up in.

import { loadInsertionData, loadMuscleData, loadSkeletonData } from "./dataset.js";
import { muscleRegions, regions } from "./regions.js";

export const subjects = {
  bones: {
    id: "bones",
    label: "Bones",
    load: loadSkeletonData,
    // Examples on the wizard's left/right step.
    sideExample: { either: "\u201CFemur\u201D: either one counts", separate: "\u201CFemur (left)\u201D, \u201CFemur (right)\u201D" },
    questions: ["name", "latin", "location"],
    answers: ["name", "latin", "location"],
    regions,
    inRegion: (item, region) => region.test(item),
  },
  attachments: {
    id: "attachments",
    label: "Muscle attachments",
    load: loadInsertionData,
    sideExample: {
      either: "\u201CDeltoid muscle \u2014 insertion\u201D: either arm counts",
      separate: "\u201C… — insertion (left)\u201D, \u201C… (right)\u201D",
    },
    questions: ["name", "latin"],
    answers: ["location"],
    regions,
    inRegion: (item, region) => item.members.some((m) => region.test(m.bone)),
  },
  muscles: {
    id: "muscles",
    label: "Muscles",
    load: loadMuscleData,
    sideExample: {
      either: "\u201CSartorius muscle\u201D: either one counts",
      separate: "\u201CSartorius muscle (left)\u201D, \u201C… (right)\u201D",
    },
    questions: ["name", "latin", "location"],
    answers: ["name", "latin", "location"],
    regions: muscleRegions,
    // Wizard wording, where the attribute's own label assumes bones.
    labels: { location: "Location on the body" },
    inRegion: (item, region) => region.test(item),
  },
};

export const subjectOf = (config) => subjects[config.subject ?? "bones"];
