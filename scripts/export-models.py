"""Export the skeleton, the muscle attachments and the muscles from the
Z-Anatomy atlas as web-ready GLBs, in one Blender run (loading the atlas
takes ~1.5 min).

Run headless via `npm run export-models` (see package.json), i.e.:

    blender -b reference/Z-Anatomy_Template/Z-Anatomy/Startup.blend \
        --python-exit-code 1 --python scripts/export-models.py

Writes:
  public/data/skeleton.glb        — one node per bone, named by its object
                                    name, decimated, Draco-compressed
  data/skeleton-objects.json      — per-bone group chain, materials and triangle
                                    counts
  public/data/insertions.glb      — one node per muscle-attachment patch
                                    ("Biceps brachii muscle.er"), named the same
  data/insertions-objects.json    — per-patch host bone, action and triangle
                                    counts
  public/data/muscles.glb         — one node per muscle ("Deltoid muscle.l"),
                                    materials "muscle" and "tendon"
  data/muscles-objects.json       — per-muscle group chain, action, the bones
                                    it lies on, side and triangle counts

The JSON files are the input to scripts/generate-data.mjs. See DESIGN.md
"Data pipeline".
"""

import json
import os
import sys

import bmesh
import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKELETON_COLLECTION = "1: Skeletal system"
INSERTIONS_COLLECTION = "2: Muscular insertions"
SKELETON_GLB = os.path.join(ROOT, "public", "data", "skeleton.glb")
SKELETON_JSON = os.path.join(ROOT, "data", "skeleton-objects.json")
INSERTIONS_GLB = os.path.join(ROOT, "public", "data", "insertions.glb")
INSERTIONS_JSON = os.path.join(ROOT, "data", "insertions-objects.json")
MUSCLES_COLLECTION = "4: Muscular system"
MUSCLES_GLB = os.path.join(ROOT, "public", "data", "muscles.glb")
MUSCLES_JSON = os.path.join(ROOT, "data", "muscles-objects.json")

# Muscles: 2.3M triangles with modifiers. Subdivision Surface is skipped
# (as for the patches; the base meshes are already smooth), then each
# muscle is decimated like the bones.
MUSCLE_DECIMATE_RATIO = float(os.environ.get("MUSCLE_DECIMATE_RATIO", "0.15"))
MUSCLE_MIN_TRIS = 300
# The muscular system collection also holds bursae, fasciae, retinacula,
# tendon sheaths, standalone tendons, ligaments and the tarsal plates. A
# muscle is an object whose first material is one of the atlas's action
# materials (Flexion, Abductor, …); these first materials aren't.
NOT_MUSCLE_MATERIALS = {"Tendon", "Bursa", "Fascia", "Ligament", "Articular capsule", "Cartilage", "Text"}
# A muscle "lies on" a bone when this share of its sampled vertices are
# within MUSCLE_BONE_REACH of that bone (for the game's backdrop bones).
MUSCLE_BONE_REACH = 0.006
MUSCLE_BONE_SHARE = 0.03

# Bones: fraction of triangles kept per object, and a floor so small bones
# (phalanges, ossicles) don't collapse into blobs.
DECIMATE_RATIO = float(os.environ.get("DECIMATE_RATIO", "0.25"))
MIN_TRIS = int(os.environ.get("MIN_TRIS", "400"))

# Attachment patches are 0.5 mm Solidify shells (offset outward) over a
# Subdivision Surface. With every modifier applied they come to ~931k
# triangles, so Subdivision is skipped (~130k), the shell is thickened to
# 1 mm so the patches aren't buried in the decimated bones, and they're
# decimated gently: harder decimation tears thin shells.
INSERTION_THICKNESS = 0.001
INSERTION_DECIMATE_RATIO = 0.5
INSERTION_MIN_TRIS = 40

# Sub-part meshes parented to a bone mesh. Air cells are part of the bone's
# shape, so they're merged in; the sinuses are interior cavities that can't
# be seen or clicked, so they're dropped.
MERGE_INTO_PARENT = {
    "Anterior cells of ethmoid bone.l",
    "Anterior cells of ethmoid bone.r",
    "Middle cells of ethmoid bone.l",
    "Middle cells of ethmoid bone.r",
    "Posterior cells of ethmoid bone.l",
    "Posterior cells of ethmoid bone.r",
}
EXCLUDE = {"Sinus of frontal bone", "Sinus of sphenoid bone"}


def material_kind(name):
    n = name.lower()
    if "teeth" in n or "tooth" in n:
        return "tooth"
    if "cartilage" in n:
        return "cartilage"
    return "bone"


def group_chain(obj):
    """Names of the `.g` group ancestors, nearest first."""
    chain = []
    p = obj.parent
    while p:
        if p.name.endswith(".g"):
            chain.append(p.name)
        p = p.parent
    return chain


def tri_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def used_materials(mesh):
    """Names of the materials some face actually uses."""
    used = {p.material_index for p in mesh.polygons}
    return sorted({mesh.materials[i].name for i in used if i < len(mesh.materials) and mesh.materials[i]})


def replace_materials(mesh, materials):
    """Puts `materials` into the mesh's slots, one per slot, in place.
    Never materials.clear() + append: in Blender 5 clearing the slots resets
    every face to slot 0, which silently turned all tendons into muscle and
    all articular cartilage into bone (found by checking the GLB's
    primitives against the atlas's face counts)."""
    if len(mesh.materials) == 0:
        mesh.materials.append(materials[0])
        return
    for i, m in enumerate(materials):
        mesh.materials[i] = m


def baked_mesh(obj, depsgraph, kind_materials):
    """World-space copy of obj with all modifiers applied and materials
    replaced by the shared bone/cartilage/tooth set."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    mesh.transform(obj.matrix_world)
    if obj.matrix_world.determinant() < 0:
        mesh.flip_normals()
    kinds = [material_kind(m.name) if m else "bone" for m in mesh.materials] or ["bone"]
    replace_materials(mesh, [kind_materials[k] for k in kinds])
    return mesh


def decimate(mesh, ratio=None, min_tris=None):
    ratio = DECIMATE_RATIO if ratio is None else ratio
    min_tris = MIN_TRIS if min_tris is None else min_tris
    tris = tri_count(mesh)
    target = max(min_tris, int(tris * ratio))
    if target >= tris:
        return
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    tmp = bpy.data.objects.new("_decimate", mesh)
    bpy.context.scene.collection.objects.link(tmp)
    mod = tmp.modifiers.new("decimate", "DECIMATE")
    mod.ratio = target / tri_count(mesh)
    mod.use_collapse_triangulate = True
    depsgraph = bpy.context.evaluated_depsgraph_get()
    decimated = bpy.data.meshes.new_from_object(tmp.evaluated_get(depsgraph))
    bpy.data.objects.remove(tmp)
    mesh.clear_geometry()
    bm = bmesh.new()
    bm.from_mesh(decimated)
    bm.to_mesh(mesh)
    bm.free()
    bpy.data.meshes.remove(decimated)


def pieces(bm):
    """Connected pieces of a bmesh, as lists of faces."""
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, piece = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            piece.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        out.append(piece)
    return out


def piece_volume_area(faces):
    """Signed volume (outward faces: positive) and area of triangulated faces."""
    vol = area = 0.0
    for f in faces:
        a, b, c = (v.co for v in f.verts[:3])
        vol += a.dot(b.cross(c)) / 6
        area += f.calc_area()
    return vol, area


# Muscle cleanup (seal(clean=True)): flat scraps thinner than this
# (3 · volume / area, metres) are deleted.
SLIVER = 0.00005


def seal(mesh, clean=False):
    """Makes a mesh watertight with outward-facing faces, so the viewer's
    cut caps (back faces seen through the cut) fill every cross-section.
    Fills holes (14 bones and 6 patches had a few open edges, partly from
    decimation) and recalculates normals outward (two temporalis patches
    were inside out). Returns {what: count} of the repairs made.

    clean (muscles): the muscle meshes also had, after decimation, 1-triangle
    specks, flat inside-out slivers, single bundles facing inward (one of
    multifidus thoracis's 21) and duplicated faces (longus colli: hundreds
    of edges shared by four faces), which break the stencil caps (they
    count crossings). So: weld coincident vertices, drop duplicate faces
    and pieces under 4 triangles, then after filling and recalculating,
    turn every inward piece outward and delete slivers. Bones and patches
    have none of these (checked the same way), so they're left as they
    were verified."""
    bm = bmesh.new()
    bm.from_mesh(mesh)
    report = {}
    if clean:
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
        bm.verts.index_update()
        keys, dupes = set(), []
        for f in bm.faces:
            k = tuple(sorted(v.index for v in f.verts))
            if k in keys:
                dupes.append(f)
            else:
                keys.add(k)
        if dupes:
            bmesh.ops.delete(bm, geom=dupes, context="FACES_ONLY")
            report["duplicateFaces"] = len(dupes)
        bm.faces.index_update()
        specks = [f for p in pieces(bm) if len(p) < 4 for f in p]
        if specks:
            bmesh.ops.delete(bm, geom=specks, context="FACES")
            report["specksRemoved"] = len(specks)
        loose = [v for v in bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm, geom=loose, context="VERTS")
    open_edges = [e for e in bm.edges if e.is_boundary]
    if open_edges:
        bmesh.ops.holes_fill(bm, edges=open_edges, sides=0)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        report["openEdgesFilled"] = len(open_edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if clean:
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        bm.faces.index_update()
        reversed_, slivers = 0, []
        for p in pieces(bm):
            vol, area = piece_volume_area(p)
            if area > 0 and 3 * abs(vol) / area < SLIVER:
                slivers.extend(p)
            elif vol < 0:
                bmesh.ops.reverse_faces(bm, faces=p)
                reversed_ += 1
        if slivers:
            bmesh.ops.delete(bm, geom=slivers, context="FACES")
            report["sliverFacesRemoved"] = len(slivers)
        if reversed_:
            report["piecesReversed"] = reversed_
    # recalc_face_normals can leave a thin or folded shell pointing inward
    # (the two temporalis "o3" patches); a negative signed volume says so.
    elif bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    return report


def join_into(target_mesh, other_mesh):
    bm = bmesh.new()
    bm.from_mesh(target_mesh)
    offset = len(target_mesh.materials)
    for m in other_mesh.materials:
        target_mesh.materials.append(m)
    tmp = bmesh.new()
    tmp.from_mesh(other_mesh)
    for f in tmp.faces:
        f.material_index += offset
    tmp.to_mesh(other_mesh)
    tmp.free()
    bm.from_mesh(other_mesh)
    bm.to_mesh(target_mesh)
    bm.free()


def new_material(name):
    # Same trap as object names: an existing material called "bone" would
    # make this "bone.001", and the viewer and generate-data match these
    # names exactly.
    mat = bpy.data.materials.new(name)
    if mat.name != name:
        raise RuntimeError(f"material named {mat.name!r}, expected {name!r}")
    return mat


def export_objects(baked, out_glb):
    """Links each baked mesh as an object with exactly its own name, selects
    only those, and writes them as a Draco GLB."""
    scene = bpy.context.scene
    for o in scene.objects:
        o.select_set(False)
    for name, mesh in baked.items():
        mesh.name = name
        # The source object still holds this name; move it aside, or Blender
        # names the export copy "Femur.l.001" and the ids stop matching.
        if name in bpy.data.objects:
            bpy.data.objects[name].name = f"{name} [source]"
        out_obj = bpy.data.objects.new(name, mesh)
        if out_obj.name != name:
            raise RuntimeError(f"export object named {out_obj.name!r}, expected {name!r}")
        scene.collection.objects.link(out_obj)
        out_obj.select_set(True)

    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
    )


def write_records(records, out_json, out_glb, label):
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    out = sorted(records.values(), key=lambda r: r["name"])
    with open(out_json, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    total_src = sum(r["sourceTris"] for r in out)
    total = sum(r["tris"] for r in out)
    print(
        f"EXPORT {label} objects={len(out)} tris {total_src} -> {total} "
        f"glb={os.path.getsize(out_glb) / 1e6:.2f} MB"
    )


def main():
    only = os.environ.get("EXPORT_ONLY")  # e.g. "muscles": skip writing the others
    bones = export_skeleton(write=only in (None, "skeleton"))
    if only in (None, "insertions"):
        export_insertions()
    if only in (None, "muscles"):
        export_muscles(bones)


def export_skeleton(write=True):
    """Returns the baked (decimated, world-space) bone meshes by name."""
    source = bpy.data.collections[SKELETON_COLLECTION]
    depsgraph = bpy.context.evaluated_depsgraph_get()

    kind_materials = {k: new_material(k) for k in ("bone", "cartilage", "tooth")}

    candidates = sorted(
        (
            o
            for o in source.all_objects
            if o.type == "MESH"
            and len(o.data.polygons) > 0
            and not o.name.endswith(".g")
            and o.name not in EXCLUDE
        ),
        key=lambda o: o.name,
    )

    baked = {}
    records = {}
    for obj in candidates:
        if obj.name in MERGE_INTO_PARENT:
            continue
        mesh = baked_mesh(obj, depsgraph, kind_materials)
        baked[obj.name] = mesh
        records[obj.name] = {
            "name": obj.name,
            "groups": group_chain(obj),
            "sourceTris": tri_count(mesh),
            "merged": [],
        }

    for obj in candidates:
        if obj.name not in MERGE_INTO_PARENT:
            continue
        parent = obj.parent.name
        part = baked_mesh(obj, depsgraph, kind_materials)
        records[parent]["sourceTris"] += tri_count(part)
        records[parent]["merged"].append(obj.name)
        join_into(baked[parent], part)
        bpy.data.meshes.remove(part)

    for name, mesh in baked.items():
        decimate(mesh)
        records[name].update(seal(mesh))
        records[name]["tris"] = tri_count(mesh)
        records[name]["materials"] = used_materials(mesh)
    if not write:
        return baked
    export_objects(baked, SKELETON_GLB)
    write_records(records, SKELETON_JSON, SKELETON_GLB, "skeleton")
    # Out of the way of the next export's selection.
    for name in baked:
        bpy.data.objects[name].select_set(False)
    return baked


# Side from geometry: a patch whose centre is at least this far from the
# midline (|x|, metres) is labelled by the side it lies on (x > 0 = left).
# Paired patches near the midline sit at ±1.4 mm or more (geniohyoid,
# procerus, rectus capitis posterior); a 5 mm zone (tried first) kept
# wrong labels on several of them. Closer than this, a patch on a sided
# bone takes the bone's side; on a midline bone it keeps its label.
MIDLINE = 0.001


def other_side(name):
    if name.endswith(".l"):
        return name[:-2] + ".r"
    if name.endswith(".r"):
        return name[:-2] + ".l"
    return name


def source_bone(name):
    """The skeleton's source object for a bone (renamed by its export)."""
    return bpy.data.objects.get(f"{name} [source]") or bpy.data.objects[name]


def world_center_x(obj):
    mw = obj.matrix_world
    xs = [(mw @ v.co).x for v in obj.data.vertices]
    return sum(xs) / len(xs)


def export_insertions():
    """Each patch is named "<muscle>.<o|e><part?><l|r>" (o = origin,
    e = insertion, "End" in the atlas) and parented to the bone it sits on.
    Its material names the muscle's action ("End-Flexion fingers"); that's
    recorded, and the exported material is just "origin" or "insertion".

    The atlas's side labels aren't reliable, so they're corrected from the
    geometry (see DESIGN.md "Data pipeline"):
    - a patch is labelled by the side it actually lies on (18 pairs were
      swapped, e.g. the scalenes and the rectus capitis origins);
    - its host becomes the bone on that side (2 were parented to the
      opposite bone);
    - an attachment modelled on one side only (11, e.g. the serratus
      posterior inferior insertion: right side only, labelled left) gets
      the other side by mirroring the patch across the midline and snapping
      it onto the mirrored bone (Shrinkwrap), since the skeleton isn't
      exactly symmetric.
    """
    source = bpy.data.collections[INSERTIONS_COLLECTION]
    role_materials = {k: new_material(k) for k in ("origin", "insertion")}
    for obj in source.all_objects:
        for m in obj.modifiers:
            if m.type == "SUBSURF":
                m.show_viewport = False
            elif m.type == "SOLIDIFY":
                m.thickness = INSERTION_THICKNESS
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()

    # Pass 1: corrected name, side and host for every patch.
    plan = []
    for obj in sorted(source.all_objects, key=lambda o: o.name):
        if obj.type != "MESH" or not obj.data.polygons:
            continue
        base, code = obj.name.rsplit(".", 1)  # code: "e1l"
        label = code[-1]
        x = world_center_x(obj)
        host = obj.parent.name.removesuffix(" [source]") if obj.parent else None
        host_side = host[-1] if host and host[-2:] in (".l", ".r") else None
        if abs(x) >= MIDLINE:
            side = "l" if x > 0 else "r"
        else:
            side = host_side or label
        host_fixed = host
        if host and host[-2:] in (".l", ".r") and host[-1] != side:
            host_fixed = other_side(host)
        plan.append({
            "obj": obj,
            "name": f"{base}.{code[:-1]}{side}",
            "slot": (base, code[:-1]),  # muscle + role + part, side-free
            "side": side,
            # Truly on the midline: never mirrored.
            "midline": abs(x) < MIDLINE and not host_side,
            "host": host_fixed,
            "hostWas": host if host_fixed != host else None,
            "labelWas": obj.name if side != label else None,
        })
    names = [p["name"] for p in plan]
    dupes = {n for n in names if names.count(n) > 1}
    if dupes:
        raise RuntimeError(f"side correction made duplicate names: {sorted(dupes)}")

    baked = {}
    records = {}

    def add(name, mesh, host, action, role, extra):
        mesh.materials.clear()
        mesh.materials.append(role_materials[role])
        source_tris = tri_count(mesh)
        decimate(mesh, INSERTION_DECIMATE_RATIO, INSERTION_MIN_TRIS)
        extra = {**extra, **seal(mesh)}
        baked[name] = mesh
        records[name] = {
            "name": name,
            "host": host,
            "action": action,
            "sourceTris": source_tris,
            "tris": tri_count(mesh),
            **extra,
        }

    for p in plan:
        obj = p["obj"]
        evaluated = obj.evaluated_get(depsgraph)
        mesh = bpy.data.meshes.new_from_object(evaluated)
        mesh.transform(obj.matrix_world)
        if obj.matrix_world.determinant() < 0:
            mesh.flip_normals()
        action = obj.data.materials[0].name if obj.data.materials and obj.data.materials[0] else None
        role = "origin" if p["slot"][1].startswith("o") else "insertion"
        extra = {}
        if p["labelWas"]:
            extra["relabelledFrom"] = p["labelWas"]
        if p["hostWas"]:
            extra["hostWas"] = p["hostWas"]
        add(p["name"], mesh, p["host"], action, role, extra)

    # Pass 2: mirror attachments that exist on one side only.
    sides = {}
    for p in plan:
        sides.setdefault(p["slot"], set()).add(p["side"])
    mirror = Matrix.Scale(-1, 4, (1, 0, 0))
    for p in plan:
        if p["midline"] or len(sides[p["slot"]]) == 2:
            continue
        obj = p["obj"]
        twin_side = "r" if p["side"] == "l" else "l"
        twin_name = f"{p['slot'][0]}.{p['slot'][1]}{twin_side}"
        twin_host = other_side(p["host"])
        # The bare patch (no modifiers), mirrored in world space…
        mesh = obj.data.copy()
        mesh.transform(obj.matrix_world)
        mesh.transform(mirror)
        mesh.flip_normals()
        tmp = bpy.data.objects.new("_mirror", mesh)
        bpy.context.scene.collection.objects.link(tmp)
        # …snapped onto the mirrored bone, then given the same 1 mm shell.
        wrap = tmp.modifiers.new("snap", "SHRINKWRAP")
        wrap.target = source_bone(twin_host)
        wrap.wrap_method = "NEAREST_SURFACEPOINT"
        wrap.wrap_mode = "ABOVE_SURFACE"
        wrap.offset = 0.0001
        shell = tmp.modifiers.new("shell", "SOLIDIFY")
        shell.thickness = INSERTION_THICKNESS
        shell.offset = 1.0
        depsgraph = bpy.context.evaluated_depsgraph_get()
        snapped = bpy.data.meshes.new_from_object(tmp.evaluated_get(depsgraph))
        bpy.data.objects.remove(tmp)
        bpy.data.meshes.remove(mesh)
        action = obj.data.materials[0].name if obj.data.materials and obj.data.materials[0] else None
        role = "origin" if p["slot"][1].startswith("o") else "insertion"
        add(twin_name, snapped, twin_host, action, role, {"mirroredFrom": p["name"]})
        sides[p["slot"]].add(twin_side)

    export_objects(baked, INSERTIONS_GLB)
    write_records(records, INSERTIONS_JSON, INSERTIONS_GLB, "insertions")


def bone_finder(bones):
    """One BVH over every bone mesh, and the bone each triangle belongs to."""
    verts, polys, owner = [], [], []
    for name, mesh in bones.items():
        base = len(verts)
        verts.extend(v.co.copy() for v in mesh.vertices)
        for p in mesh.polygons:
            polys.append([base + i for i in p.vertices])
            owner.append(name)
    return BVHTree.FromPolygons(verts, polys), owner


def export_muscles(bones):
    """Each muscle is one object, "<name>.<l|r>" (the diaphragm and a few
    midline muscles have no side). Its first material names its action;
    a second, "Tendon", covers its tendons. Exported with materials
    "muscle" and "tendon".

    Checks, as for the patches (MISTAKES.md: don't trust labels geometry
    can check): every sided name must match the side it lies on (none
    disagree in this atlas; the export fails if one does), and an unsided
    muscle off the midline whose other side exists gets its side from
    geometry ("Iliocostalis colli muscle" is the left one, unlabelled)."""
    source = bpy.data.collections[MUSCLES_COLLECTION]
    tissue_materials = {k: new_material(k) for k in ("muscle", "tendon")}
    candidates = [
        o
        for o in sorted(source.all_objects, key=lambda o: o.name)
        if o.type == "MESH"
        and o.data.polygons
        and o.data.materials
        and o.data.materials[0]
        and o.data.materials[0].name not in NOT_MUSCLE_MATERIALS
    ]
    for obj in candidates:
        for m in obj.modifiers:
            if m.type == "SUBSURF":
                m.show_viewport = False
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    tree, owner = bone_finder(bones)

    names = {o.name for o in candidates}
    baked, records = {}, {}
    wrong_side = []
    for obj in candidates:
        x = world_center_x(obj)
        name = obj.name
        label = name[-1] if name[-2:] in (".l", ".r") else None
        geo = None if abs(x) < MIDLINE else ("l" if x > 0 else "r")
        extra = {}
        if label and geo and label != geo:
            wrong_side.append(f"{name} (x = {x:.4f})")
        if not label and geo:
            twin = f"{name}.{'r' if geo == 'l' else 'l'}"
            if twin in names:
                extra["relabelledFrom"] = name
                name = f"{name}.{geo}"
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
        mesh.transform(obj.matrix_world)
        if obj.matrix_world.determinant() < 0:
            mesh.flip_normals()
        slots = [m.name if m else None for m in mesh.materials]
        kinds = ["tendon" if s == "Tendon" else "muscle" for s in slots] or ["muscle"]
        replace_materials(mesh, [tissue_materials[k] for k in kinds])
        source_tris = tri_count(mesh)
        decimate(mesh, MUSCLE_DECIMATE_RATIO, MUSCLE_MIN_TRIS)
        extra.update(seal(mesh, clean=True))
        # The bones it lies on: vertices within reach of a bone, by bone.
        step = max(1, len(mesh.vertices) // 400)
        near = {}
        sampled = 0
        for v in list(mesh.vertices)[::step]:
            sampled += 1
            hit = tree.find_nearest(v.co, MUSCLE_BONE_REACH)
            if hit[0] is not None:
                b = owner[hit[2]]
                near[b] = near.get(b, 0) + 1
        on_bones = sorted((b for b, n in near.items() if n / sampled >= MUSCLE_BONE_SHARE), key=lambda b: -near[b])
        baked[name] = mesh
        records[name] = {
            "name": name,
            "groups": group_chain(obj),
            "action": obj.data.materials[0].name,
            "bones": on_bones,
            "sourceTris": source_tris,
            "tris": tri_count(mesh),
            "materials": used_materials(mesh),
            **extra,
        }
    if wrong_side:
        raise RuntimeError(f"muscles lying on the other side from their label: {wrong_side}")
    dupes = len(baked) != len(candidates)
    if dupes:
        raise RuntimeError("side correction made duplicate names")
    export_objects(baked, MUSCLES_GLB)
    write_records(records, MUSCLES_JSON, MUSCLES_GLB, "muscles")


try:
    main()
except Exception:
    import traceback

    traceback.print_exc()
    sys.exit(1)
