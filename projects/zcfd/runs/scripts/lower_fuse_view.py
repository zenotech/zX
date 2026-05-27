# state file generated using paraview version 6.0.0
import sys
import os
import argparse
import subprocess

parser = argparse.ArgumentParser(description='Process Paraview state.')
parser.add_argument('--workspace_dir', type=str, help='Workspace directory')
parser.add_argument('--run_id', type=int, help='Run ID to process')
parser.add_argument('--num_parallel', type=int, default=1, help='Number of parallel processes to spawn')
parser.add_argument('--worker_id', type=int, default=-1, help='Internal use: worker ID')
args, _ = parser.parse_known_args()
run_id = args.run_id

# Parallel spawner logic
if args.num_parallel > 1 and args.worker_id == -1:
    print(f"Starting {args.num_parallel} parallel processes for run_id {run_id}...")
    processes = []
    for i in range(args.num_parallel):
        cmd = [sys.executable, sys.argv[0], '--run_id', str(run_id), '--num_parallel', str(args.num_parallel), '--worker_id', str(i)]
        print(f"Launching worker {i}: {' '.join(cmd)}")
        p = subprocess.Popen(cmd)
        processes.append(p)
        
    for i, p in enumerate(processes):
        p.wait()
        
    print("All parallel workers completed!")
    sys.exit(0)

workspace_dir = args.workspace_dir

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

# a texture
zCFD_Mark_CMYK_No_Strapline_trans = FindTextureOrCreate(registrationName='ZCFD_Mark_CMYK_No_Strapline_trans', 
                                                        filename=f'{workspace_dir}/runs/images/ZCFD_Mark_CMYK.png')

# create a new 'Logo'
logo1 = Logo(registrationName='Logo1')
logo1.Texture = zCFD_Mark_CMYK_No_Strapline_trans

# create a new 'Text'
text1 = Text(registrationName='Text1')
text1.Text = f'Run: {run_id}'

# create a new 'PVD Reader'
runpvd = PVDReader(registrationName='run.pvd', FileName=f'{workspace_dir}/runs/run_{run_id}/run_P8_OUTPUT/run.pvd')
runpvd.CellArrays = ['V', 'p', 'T', 'rho', 'mach', 'cp', 'eddy', 'lesregion', 'Qcriterion']

# create a new 'PVD Reader'
run_wallpvd = PVDReader(registrationName='run_wall.pvd', FileName=f'{workspace_dir}/runs/run_{run_id}/run_P8_OUTPUT/run_wall.pvd')
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

# show data from logo1
logo1Display = Show(logo1, renderView1, 'LogoSourceRepresentation')

# trace defaults for the display properties.
logo1Display.Position = [0.017270245677888995, 0.9020549927641099]

# show data from text1
text1Display = Show(text1, renderView1, 'TextSourceRepresentation')

# trace defaults for the display properties.
text1Display.WindowLocation = 'Lower Left Corner'

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

# get time animation track
timeAnimationCue1 = GetTimeTrack()

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

# ----------------------------------------------------------------
# restore active source
SetActiveSource(contour1)
# ----------------------------------------------------------------

# ================================================================
# custom timestep iteration and image saving loop
# ================================================================

# Define output directory for images (defaulting to current directory)
output_directory = f"{workspace_dir}/runs/run_{run_id}/images"

# Create the directory if it doesn't exist
if not os.path.exists(output_directory):
    os.makedirs(output_directory)

# Extract all available timesteps from the primary PVD reader
timesteps = runpvd.TimestepValues

if args.num_parallel > 1:
    timesteps_to_process = [(i, t) for i, t in enumerate(timesteps) if i % args.num_parallel == args.worker_id]
    print(f"[Worker {args.worker_id}] Found {len(timesteps_to_process)} timesteps to process out of {len(timesteps)}. Starting batch render...")
else:
    timesteps_to_process = list(enumerate(timesteps))
    print(f"Found {len(timesteps)} timesteps. Starting batch render...")

for i, t in timesteps_to_process:
    # Set the current time in the animation scene
    animationScene1.AnimationTime = t
    
    # Render the view to apply the time change
    RenderAllViews()
    
    # Generate a padded filename (e.g., frame_0000.png, frame_0001.png)
    filename = os.path.join(output_directory, f"frame_{i:04d}.png")
    
    print(f"Saving frame {i} at timestep {t} to {filename}...")
    
    # Save the screenshot using the view resolution defined at the top
    SaveScreenshot(filename, renderView1, ImageResolution=[2394, 1608])

print("All timesteps processed and images saved successfully!")