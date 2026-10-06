"""Export the skeletal system from the Z-Anatomy atlas as a web-ready GLB.

Run headless via `npm run export-skeleton` (see package.json), i.e.:

    blender -b reference/Z-Anatomy_Template/Z-Anatomy/Startup.blend \
        --python-exit-code 1 --python scripts/export-skeleton.py

Writes:
  public/data/skeleton.glb        — one node per quiz item, named by its object
                                    name, decimated, Draco-compressed
  data/skeleton-objects.json      — per-item group chain, materials and triangle
                                    counts, the input to scripts/generate-data.mjs

See DESIGN.md "Data pipeline".
"""

import json
import os
import sys

import bmesh
import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_COLLECTION = "1: Skeletal system"
OUT_GLB = os.path.join(ROOT, "public", "data", "skeleton.glb")
OUT_JSON = os.path.join(ROOT, "data", "skeleton-objects.json")

# Fraction of triangles kept per object, and a floor so small bones
# (phalanges, ossicles) don't collapse into blobs.
DECIMATE_RATIO = float(os.environ.get("DECIMATE_RATIO", "0.25"))
MIN_TRIS = int(os.environ.get("MIN_TRIS", "400"))

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


def baked_mesh(obj, depsgraph, kind_materials):
    """World-space copy of obj with all modifiers applied and materials
    replaced by the shared bone/cartilage/tooth set."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated)
    mesh.transform(obj.matrix_world)
    if obj.matrix_world.determinant() < 0:
        mesh.flip_normals()
    kinds = [material_kind(m.name) if m else "bone" for m in mesh.materials]
    if not kinds:
        kinds = ["bone"]
    mesh.materials.clear()
    for k in kinds:
        mesh.materials.append(kind_materials[k])
    return mesh


def decimate(mesh):
    tris = tri_count(mesh)
    target = max(MIN_TRIS, int(tris * DECIMATE_RATIO))
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


def main():
    source = bpy.data.collections[SOURCE_COLLECTION]
    depsgraph = bpy.context.evaluated_depsgraph_get()

    kind_materials = {}
    for k in ("bone", "cartilage", "tooth"):
        mat = bpy.data.materials.new(k)
        # Same trap as object names: an existing material called "bone"
        # would make this "bone.001", and the viewer and generate-data
        # match these names exactly.
        if mat.name != k:
            raise RuntimeError(f"material named {mat.name!r}, expected {k!r}")
        kind_materials[k] = mat

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

    scene = bpy.context.scene
    for o in scene.objects:
        o.select_set(False)
    for name, mesh in baked.items():
        decimate(mesh)
        mesh.name = name
        records[name]["tris"] = tri_count(mesh)
        records[name]["materials"] = sorted({m.name for m in mesh.materials})
        # The source object still holds this name; move it aside, or Blender
        # names the export copy "Femur.l.001" and the ids stop matching.
        if name in bpy.data.objects:
            bpy.data.objects[name].name = f"{name} [source]"
        out_obj = bpy.data.objects.new(name, mesh)
        if out_obj.name != name:
            raise RuntimeError(f"export object named {out_obj.name!r}, expected {name!r}")
        scene.collection.objects.link(out_obj)
        out_obj.select_set(True)

    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
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

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    out = sorted(records.values(), key=lambda r: r["name"])
    with open(OUT_JSON, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")

    total_src = sum(r["sourceTris"] for r in out)
    total = sum(r["tris"] for r in out)
    print(
        f"EXPORT objects={len(out)} tris {total_src} -> {total} "
        f"glb={os.path.getsize(OUT_GLB) / 1e6:.2f} MB"
    )


try:
    main()
except Exception:
    import traceback

    traceback.print_exc()
    sys.exit(1)
