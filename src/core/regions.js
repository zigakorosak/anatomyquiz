// Region filter registry: a two-level tree of predicates over quiz items.
//
// A region doesn't crop the model. Every region shares the same skeleton;
// items outside the region are muted (ghosted and not clickable) and the
// camera frames the region. Same idea as GeoQuiz's "one map for every region".

const inGroup = (g) => (item) => item.groups.includes(g);
const ARM_BONES = new Set(["Humerus", "Radius", "Ulna"]);

const isHand = (i) =>
  i.groups[0] === "Bones of free part of upper limb" && !ARM_BONES.has(i.name);
const isFoot = inGroup("Bones of foot");
const isOssicle = inGroup("Auditory ossicles");

// The ossicles sit inside the temporal bone, where they can't be seen or
// clicked unless the temporal bone is muted, so they only appear in their own
// region.
const isSkull = (i) =>
  (inGroup("Cranium")(i) || inGroup("Extracranial bones of head")(i)) && !isOssicle(i);

export const regions = [
  { id: "all", label: "Whole skeleton", test: (i) => !isOssicle(i) },
  {
    id: "head",
    label: "Head & neck",
    children: [
      { id: "skull", label: "Skull", test: isSkull },
      { id: "teeth", label: "Teeth", test: inGroup("Teeth") },
      {
        id: "head-cartilages",
        label: "Nasal & laryngeal cartilages",
        test: (i) => inGroup("Nasal cartilages")(i) || inGroup("Laryngeal cartilages")(i),
      },
      // standalone: left out of the parent's "All of it", for the same
      // reason as Whole skeleton (inside an opaque, clickable temporal bone).
      { id: "ossicles", label: "Ear ossicles", test: isOssicle, standalone: true },
    ],
  },
  {
    id: "trunk",
    label: "Trunk",
    children: [
      { id: "spine", label: "Vertebral column", test: inGroup("Vertebral column") },
      { id: "thorax", label: "Thorax", test: inGroup("Thoracic skeleton") },
    ],
  },
  {
    id: "upper",
    label: "Upper limb",
    children: [
      {
        id: "arm",
        label: "Shoulder & arm",
        test: (i) => inGroup("Bones of upper limb")(i) && !isHand(i),
      },
      { id: "hand", label: "Hand", test: isHand },
    ],
  },
  {
    id: "lower",
    label: "Lower limb",
    children: [
      {
        id: "leg",
        label: "Pelvis & leg",
        test: (i) => inGroup("Bones of lower limb")(i) && !isFoot(i),
      },
      { id: "foot", label: "Foot", test: isFoot },
    ],
  },
];

// A parent region's own test is "any of its children", except standalone ones.
for (const r of regions) {
  if (r.children) {
    const included = r.children.filter((c) => !c.standalone);
    r.test = (i) => included.some((c) => c.test(i));
  }
}

export function findRegion(id) {
  for (const r of regions) {
    if (r.id === id) return r;
    for (const c of r.children ?? []) if (c.id === id) return c;
  }
  return null;
}
