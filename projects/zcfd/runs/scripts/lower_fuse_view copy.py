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
    AxesGrid='Grid Axes 3D Actor',
    CenterOfRotation=[4.672046184539795, 0.0031986236572265625, 1.346551239490509],
    CameraPosition=[3.063733302109107, -0.2883928673444891, -36.39661217555981],
    CameraFocalPoint=[4.672046184539795, 0.0031986236572265625, 1.346551239490509],
    CameraViewAngle=26.803482587064675,
    CameraFocalDisk=1.0,
    CameraParallelScale=9.777805634359318,
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
runpvd = PVDReader(registrationName='run.pvd', FileName='/n/projects/EMB/EVE/FLYOVER/runs/run_3/run_P8_OUTPUT/run.pvd')
runpvd.CellArrays = ['V', 'p', 'T', 'rho', 'mach', 'cp', 'eddy', 'lesregion', 'Qcriterion']

# create a new 'PVD Reader'
run_wallpvd = PVDReader(registrationName='run_wall.pvd', FileName='/n/projects/EMB/EVE/FLYOVER/runs/run_2/run_P8_OUTPUT/run_wall.pvd')
run_wallpvd.CellArrays = ['zone', 'cp', 'cf', 'yplus', 'V']

# create a new 'Clip'
clip1 = Clip(registrationName='Clip1', Input=runpvd)
clip1.Set(
    ClipType='Sphere',
    Crinkleclip=1,
)

# init the 'Sphere' selected for 'ClipType'
clip1.ClipType.Set(
    Center=[3.0, 0.0, 0.0],
    Radius=10.0,
)

# init the 'Plane' selected for 'HyperTreeGridClipper'
clip1.HyperTreeGridClipper.Origin = [3.4129714965820312, 0.00157928466796875, 1.6706695556640625]

# create a new 'Contour'
contour1 = Contour(registrationName='Contour1', Input=clip1)
contour1.Set(
    ContourBy=['POINTS', 'Qcriterion'],
    Isosurfaces=[100.0],
    PointMergeMethod='Uniform Binning',
)

# ----------------------------------------------------------------
# setup the visualization in view 'renderView1'
# ----------------------------------------------------------------

# show data from run_wallpvd
run_wallpvdDisplay = Show(run_wallpvd, renderView1, 'GeometryRepresentation')

# trace defaults for the display properties.
run_wallpvdDisplay.Set(
    Representation='Surface',
    ColorArrayName=['POINTS', ''],
    DataAxesGrid='Grid Axes Representation',
    PolarAxes='Polar Axes Representation',
)

# show data from contour1
contour1Display = Show(contour1, renderView1, 'GeometryRepresentation')

# get 2D transfer function for 'lesregion'
lesregionTF2D = GetTransferFunction2D('lesregion')
lesregionTF2D.Set(
    ScalarRangeInitialized=1,
    Range=[6.174347504384059e-07, 1.0, 0.0, 1.0],
)

# get color transfer function/color map for 'lesregion'
lesregionLUT = GetColorTransferFunction('lesregion')
lesregionLUT.Set(
    TransferFunction2D=lesregionTF2D,
    RGBPoints=GenerateRGBPoints(
        range_min=6.174347504384059e-07,
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
    DataAxesGrid='Grid Axes Representation',
    PolarAxes='Polar Axes Representation',
)

# init the 'Piecewise Function' selected for 'ScaleTransferFunction'
contour1Display.ScaleTransferFunction.Points = [100.0, 0.0, 0.5, 0.0, 100.015625, 1.0, 0.5, 0.0]

# init the 'Piecewise Function' selected for 'OpacityTransferFunction'
contour1Display.OpacityTransferFunction.Points = [100.0, 0.0, 0.5, 0.0, 100.015625, 1.0, 0.5, 0.0]

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
    Points=[6.174347504384059e-07, 0.0, 0.5, 0.0, 1.0, 1.0, 0.5, 0.0],
    ScalarRangeInitialized=1,
)

# ----------------------------------------------------------------
# setup animation scene, tracks and keyframes
# note: the Get..() functions create a new object, if needed
# ----------------------------------------------------------------

# get the time-keeper
timeKeeper1 = GetTimeKeeper()

# initialize the timekeeper

# get time animation track
timeAnimationCue1 = GetTimeTrack()

# initialize the animation track

# get animation scene
animationScene1 = GetAnimationScene()

# initialize the animation scene
animationScene1.Set(
    ViewModules=renderView1,
    Cues=timeAnimationCue1,
    AnimationTime=8100.0,
    EndTime=8100.0,
    PlayMode='Snap To TimeSteps',
)

# initialize the animation scene

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