# state file generated using paraview version 6.0.0
import paraview
paraview.compatibility.major = 6
paraview.compatibility.minor = 0

#### import the simple module from the paraview
from paraview.simple import *
#### disable automatic camera reset on 'Show'
paraview.simple._DisableFirstRenderCameraReset()

# ----------------------------------------------------------------
# setup views used in the visualization
# ----------------------------------------------------------------

# get the material library
materialLibrary1 = GetMaterialLibrary()

# Create a new 'Render View'
renderView1 = CreateView('RenderView')
renderView1.Set(
    ViewSize=[2394, 1608],
    CenterOfRotation=[4.133549332618713, 0.0018661022186279297, 1.3379047214984894],
    CameraPosition=[40.853845173147256, 0.0018661022186279297, 1.3379047214984894],
    CameraFocalPoint=[14.87717615181234, 0.560258605785123, 1.091173150155154],
    CameraViewUp=[0.0, 0.0, 1.0],
    CameraViewAngle=4.949874686716791,
    CameraFocalDisk=1.0,
    CameraParallelScale=9.503911905327662,
    EnableRayTracing=1,
    BackEnd='OSPRay raycaster',
    Shadows=1,
    OSPRayMaterialLibrary=materialLibrary1,
)

SetActiveView(None)

# ----------------------------------------------------------------
# setup view layouts
# ----------------------------------------------------------------

# create new layout object 'Layout #1'
layout1 = CreateLayout(name='Layout #1')
layout1.AssignView(0, renderView1)
layout1.SetSize(2394, 1608)

# ----------------------------------------------------------------
# restore active view
SetActiveView(renderView1)
# ----------------------------------------------------------------

# ----------------------------------------------------------------
# setup the data processing pipelines
# ----------------------------------------------------------------

# create a new 'PVD Reader'
runpvd = PVDReader(registrationName='run.pvd', FileName='/n/projects/EMB/EVE/FLYOVER/runs/run_2/run_P4_OUTPUT/run.pvd')
runpvd.CellArrays = ['V', 'p', 'T', 'rho', 'mach', 'cp', 'eddy', 'lesregion', 'Qcriterion']

# create a new 'Clip'
clip1 = Clip(registrationName='Clip1', Input=runpvd)
clip1.Set(
    ClipType='Sphere',
    Crinkleclip=1,
)

# init the 'Sphere' selected for 'ClipType'
clip1.ClipType.Set(
    Center=[3.0, -0.0, 0.0],
    Radius=10.0,
)

# init the 'Plane' selected for 'HyperTreeGridClipper'
clip1.HyperTreeGridClipper.Origin = [3.4129714965820312, 0.00157928466796875, 1.6706695556640625]

# create a new 'Slice'
slice1 = Slice(registrationName='Slice1', Input=clip1)
slice1.Set(
    Triangulatetheslice=0,
    SliceOffsetValues=[0.0],
)

# init the 'Plane' selected for 'SliceType'
slice1.SliceType.Origin = [2.5, 0.004535675048828125, -0.7677974700927734]

# init the 'Plane' selected for 'HyperTreeGridSlicer'
slice1.HyperTreeGridSlicer.Origin = [2.923039436340332, 0.004535675048828125, -0.7677974700927734]

# create a new 'Contour'
contour1 = Contour(registrationName='Contour1', Input=clip1)
contour1.Set(
    ContourBy=['POINTS', 'Qcriterion'],
    Isosurfaces=[100.0],
)

# create a new 'PVD Reader'
run_wallpvd = PVDReader(registrationName='run_wall.pvd', FileName='/n/projects/EMB/EVE/FLYOVER/runs/run_2/run_P4_OUTPUT/run_wall.pvd')
run_wallpvd.CellArrays = ['zone', 'cp', 'cf', 'yplus', 'V']

# create a new 'Threshold'
threshold1 = Threshold(registrationName='Threshold1', Input=run_wallpvd)
threshold1.Set(
    Scalars=['CELLS', 'yplus'],
    LowerThreshold=100.0,
    UpperThreshold=1372.1044921875,
)

# create a new 'Slice'
slice2 = Slice(registrationName='Slice2', Input=clip1)
slice2.SliceOffsetValues = [0.0]

# init the 'Plane' selected for 'SliceType'
slice2.SliceType.Set(
    Origin=[3.0, 0.0, 1.7],
    Normal=[0.0, 0.0, 1.0],
)

# init the 'Plane' selected for 'HyperTreeGridSlicer'
slice2.HyperTreeGridSlicer.Origin = [2.923039436340332, 0.004535675048828125, -0.7677974700927734]

# ----------------------------------------------------------------
# setup the visualization in view 'renderView1'
# ----------------------------------------------------------------

# show data from run_wallpvd
run_wallpvdDisplay = Show(run_wallpvd, renderView1, 'GeometryRepresentation')

# trace defaults for the display properties.
run_wallpvdDisplay.Set(
    Representation='Surface',
    ColorArrayName=['POINTS', ''],
)

# show data from contour1
contour1Display = Show(contour1, renderView1, 'GeometryRepresentation')

# get color transfer function/color map for 'lesregion'
lesregionLUT = GetColorTransferFunction('lesregion')
lesregionLUT.Set(
    RGBPoints=GenerateRGBPoints(
        range_min=7.396355613309424e-06,
        range_max=1.0,
    ),
    ScalarRangeInitialized=1.0,
)

# trace defaults for the display properties.
contour1Display.Set(
    Representation='Surface',
    ColorArrayName=['CELLS', 'lesregion'],
    LookupTable=lesregionLUT,
    SelectNormalArray='Normals',
)

# init the 'Piecewise Function' selected for 'ScaleTransferFunction'
contour1Display.ScaleTransferFunction.Points = [500.0, 0.0, 0.5, 0.0, 500.0625, 1.0, 0.5, 0.0]

# init the 'Piecewise Function' selected for 'OpacityTransferFunction'
contour1Display.OpacityTransferFunction.Points = [500.0, 0.0, 0.5, 0.0, 500.0625, 1.0, 0.5, 0.0]

# setup the color legend parameters for each legend in this view

# get color legend/bar for lesregionLUT in view renderView1
lesregionLUTColorBar = GetScalarBar(lesregionLUT, renderView1)
lesregionLUTColorBar.Set(
    WindowLocation='Upper Right Corner',
    Title='lesregion',
    ComponentTitle='',
)

# set color bar visibility
lesregionLUTColorBar.Visibility = 1

# show color legend
contour1Display.SetScalarBarVisibility(renderView1, True)

# ----------------------------------------------------------------
# setup color maps and opacity maps used in the visualization
# note: the Get..() functions create a new object, if needed
# ----------------------------------------------------------------

# get opacity transfer function/opacity map for 'lesregion'
lesregionPWF = GetOpacityTransferFunction('lesregion')
lesregionPWF.Set(
    Points=[7.396355613309424e-06, 0.0, 0.5, 0.0, 1.0, 1.0, 0.5, 0.0],
    ScalarRangeInitialized=1,
)

# ----------------------------------------------------------------
# setup animation scene, tracks and keyframes
# note: the Get..() functions create a new object, if needed
# ----------------------------------------------------------------

# get time animation track
timeAnimationCue1 = GetTimeTrack()

# initialize the animation scene

# get the time-keeper
timeKeeper1 = GetTimeKeeper()

# initialize the timekeeper

# initialize the animation track

# get animation scene
animationScene1 = GetAnimationScene()

# initialize the animation scene
animationScene1.Set(
    ViewModules=renderView1,
    Cues=timeAnimationCue1,
    AnimationTime=0.0,
    PlayMode='Snap To TimeSteps',
)

# ----------------------------------------------------------------
# restore active source
SetActiveSource(contour1)
# ----------------------------------------------------------------


##--------------------------------------------
## You may need to add some code at the end of this python script depending on your usage, eg:
#
## Render all views to see them appears
# RenderAllViews()
#
## Interact with the view, usefull when running from pvpython
# Interact()
#
## Save a screenshot of the active view
# SaveScreenshot("path/to/screenshot.png")
#
## Save a screenshot of a layout (multiple splitted view)
# SaveScreenshot("path/to/screenshot.png", GetLayout())
#
## Save all "Extractors" from the pipeline browser
# SaveExtracts()
#
## Save a animation of the current active view
# SaveAnimation()
#
## Please refer to the documentation of paraview.simple
## https://www.paraview.org/paraview-docs/latest/python/paraview.simple.html
##--------------------------------------------