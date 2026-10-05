# -*- coding: utf-8 -*-
# 4-bedroom apartment plan (13,100 x 11,200) -> Revit model.
# Run inside Revit: Dynamo "Python Script" node, or as a pyRevit script.
# Outside Revit (plain python) it only runs the geometry self-check.
# Coordinates in mm, origin = bottom-left of the plan, x right, y up.

WALL_HEIGHT = 2800
EXT_WIDTH = 200   # picks the existing basic wall type closest to this
INT_WIDTH = 100

# Floor outline (includes balconies; entrance pokes out on the left)
OUTLINE = [(1400, 0), (13100, 0), (13100, 11200), (1400, 11200),
           (1400, 6400), (500, 6400), (500, 4900), (1400, 4900)]

# (start, end, exterior?)
WALLS = [
    # exterior
    ((1400, 0), (13100, 0), True),
    ((13100, 0), (13100, 11200), True),
    ((13100, 11200), (1400, 11200), True),
    ((1400, 11200), (1400, 6400), True),
    ((1400, 6400), (500, 6400), True),
    ((500, 6400), (500, 4900), True),
    ((500, 4900), (1400, 4900), True),
    ((1400, 4900), (1400, 0), True),
    # balcony / room walls
    ((1400, 9900), (4400, 9900), True),
    ((4400, 9900), (4400, 11200), False),
    ((7700, 9700), (13100, 9700), True),
    ((7700, 9700), (7700, 11200), False),
    ((1400, 1600), (8900, 1600), True),
    ((8900, 1300), (13100, 1300), True),
    ((8900, 1300), (8900, 1600), True),
    # interior
    ((4400, 6400), (4400, 9900), False),
    ((1400, 6400), (4400, 6400), False),
    ((1400, 4900), (4400, 4900), False),
    ((4400, 1600), (4400, 4900), False),
    ((4400, 8100), (7000, 8100), False),   # bath 1
    ((7000, 6700), (7000, 8100), False),
    ((4400, 6700), (7000, 6700), False),
    ((9500, 6700), (9500, 9700), False),
    ((9500, 6700), (13100, 6700), False),
    ((10500, 5200), (10500, 6700), False),  # bath 2
    ((8900, 5200), (13100, 5200), False),
    ((8900, 1600), (8900, 5200), False),
]

# Open-plan boundaries (no wall): entrance, kitchen/hall, living/hall
SEPARATIONS = [
    ((1400, 4900), (1400, 6400)),
    ((7000, 6700), (9500, 6700)),
    ((4400, 4900), (8900, 4900)),
]

ROOMS = [
    (u'침실1', (2900, 8150)), (u'침실2', (2900, 3250)),
    (u'침실3', (11300, 8200)), (u'침실4', (11000, 3250)),
    (u'거실', (6650, 3250)), (u'주방 및 식당', (8200, 8200)),
    (u'욕실1', (5700, 7400)), (u'욕실2', (11800, 5950)),
    (u'현관', (950, 5650)), (u'복도', (6000, 5800)),
    (u'발코니1', (2900, 10550)), (u'발코니2', (10400, 10450)),
    (u'발코니3', (7000, 650)),
]

# Points on a wall centerline
DOORS = [(500, 5650), (3700, 6400), (3700, 4900), (6200, 6700),
         (10000, 6700), (10500, 6000), (9700, 5200), (8600, 9700)]
WINDOWS = [(2900, 9900), (11300, 9700), (2900, 1600), (6650, 1600),
           (11000, 1300), (6050, 11200), (2900, 11200), (10400, 11200),
           (4000, 0), (10000, 0), (13100, 8200), (13100, 3250),
           (1400, 3250), (1400, 8150)]


def host_index(pt, margin=0):
    """Index of the wall whose centerline holds pt (with margin from both ends)."""
    x, y = pt
    for i, ((x1, y1), (x2, y2), _) in enumerate(WALLS):
        if x1 == x2 == x and min(y1, y2) + margin <= y <= max(y1, y2) - margin:
            return i
        if y1 == y2 == y and min(x1, x2) + margin <= x <= max(x1, x2) - margin:
            return i
    return None


def build():
    import clr
    clr.AddReference('RevitAPI')
    from System.Collections.Generic import List
    from Autodesk.Revit.DB import (
        XYZ, UV, Line, CurveLoop, CurveArray, Wall, WallType, WallKind, Floor,
        FloorType, Level, ViewPlan, SketchPlane, FilteredElementCollector,
        BuiltInCategory, FamilySymbol, Transaction)
    from Autodesk.Revit.DB.Structure import StructuralType

    try:
        doc = __revit__.ActiveUIDocument.Document  # pyRevit
        tm = None
    except NameError:  # Dynamo
        clr.AddReference('RevitServices')
        from RevitServices.Persistence import DocumentManager
        from RevitServices.Transactions import TransactionManager
        doc = DocumentManager.Instance.CurrentDBDocument
        tm = TransactionManager.Instance

    ft = lambda mm: mm / 304.8
    xyz = lambda p: XYZ(ft(p[0]), ft(p[1]), 0)
    line = lambda a, b: Line.CreateBound(xyz(a), xyz(b))

    level = sorted(FilteredElementCollector(doc).OfClass(Level),
                   key=lambda l: l.Elevation)[0]
    view = [v for v in FilteredElementCollector(doc).OfClass(ViewPlan)
            if not v.IsTemplate and v.GenLevel and v.GenLevel.Id == level.Id][0]
    wtypes = [t for t in FilteredElementCollector(doc).OfClass(WallType)
              if t.Kind == WallKind.Basic]
    closest = lambda mm: min(wtypes, key=lambda t: abs(t.Width - ft(mm)))
    ext_type, int_type = closest(EXT_WIDTH), closest(INT_WIDTH)

    def first_symbol(cat):
        s = FilteredElementCollector(doc).OfCategory(cat) \
            .OfClass(FamilySymbol).FirstElement()
        if s and not s.IsActive:
            s.Activate()
        return s

    if tm:
        tm.EnsureInTransaction(doc)
    else:
        t = Transaction(doc, 'Apartment plan')
        t.Start()

    walls = [Wall.Create(doc, line(a, b), (ext_type if ext else int_type).Id,
                         level.Id, ft(WALL_HEIGHT), 0, False, False)
             for a, b, ext in WALLS]

    loop = CurveLoop()
    for a, b in zip(OUTLINE, OUTLINE[1:] + OUTLINE[:1]):
        loop.Append(line(a, b))
    ftype = FilteredElementCollector(doc).OfClass(FloorType).FirstElement()
    try:
        Floor.Create(doc, List[CurveLoop]([loop]), ftype.Id, level.Id)
    except AttributeError:  # Revit 2021 and older
        ca = CurveArray()
        for c in loop:
            ca.Append(c)
        doc.Create.NewFloor(ca, False)

    seps = CurveArray()
    for a, b in SEPARATIONS:
        seps.Append(line(a, b))
    doc.Create.NewRoomBoundaryLines(SketchPlane.Create(doc, level.Id), seps, view)

    door = first_symbol(BuiltInCategory.OST_Doors)
    window = first_symbol(BuiltInCategory.OST_Windows)
    doc.Regenerate()
    # ponytail: one door/window type for all, at its default size; swap types in Revit
    for sym, pts in ((door, DOORS), (window, WINDOWS)):
        for p in pts if sym else []:
            doc.Create.NewFamilyInstance(xyz(p), sym, walls[host_index(p)],
                                         level, StructuralType.NonStructural)

    doc.Regenerate()
    for name, p in ROOMS:
        doc.Create.NewRoom(level, UV(ft(p[0]), ft(p[1]))).Name = name

    if tm:
        tm.TransactionTaskDone()
    else:
        t.Commit()
    return 'walls %d, doors %d, windows %d, rooms %d' % (
        len(walls), len(DOORS) if door else 0,
        len(WINDOWS) if window else 0, len(ROOMS))


try:
    import clr
    clr.AddReference('RevitAPI')
    IN_REVIT = True
except Exception:
    IN_REVIT = False

if IN_REVIT:
    OUT = build()
    print(OUT)
else:
    for p in DOORS:
        assert host_index(p, 450) is not None, p   # 900 door fits on its wall
    for p in WINDOWS:
        assert host_index(p, 500) is not None, p
    for _, (x, y) in ROOMS:
        assert 0 <= x <= 13100 and 0 <= y <= 11200
    print('geometry ok')
