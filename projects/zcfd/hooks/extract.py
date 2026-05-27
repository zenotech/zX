from pathlib import Path
import csv
import numpy as np
import pandas as pd

def fullbody_forces(x, y, z):
    x += -x
    y += y
    z += z
    return x, y, z

def fullbody_moments(x, y, z):
    x += x
    y += -y
    z += -z
    return x, y, z

def transform_forces(alpha, beta, x, y, z):
    import numpy as np
    a, b = np.radians(alpha), np.radians(beta)
    
    v_wx = np.cos(b) * x - np.sin(a) * np.sin(b) * y + np.cos(a) * np.sin(b) * z
    v_wy = np.cos(a) * y + np.sin(a) * z
    v_wz = -np.sin(b) * x - np.sin(a) * np.cos(b) * y + np.cos(a) * np.cos(b) * z
    
    return v_wx, v_wy, v_wz

def get_cg(alpha, beta):
    baseline_cg = [0.23325,0.0,1.24323]
    centre_of_rotation = [0.0,0.0,0.818]
    # this is the transform about the centre of rotation - to be used for geometry
    def my_transform(x,y,z, alpha, beta):
        point = [x,y,z]
        vec_cg_to_origin = [point[i] - centre_of_rotation[i] for i in range(3)]
        rotated_vec = zutil.rotate_vector(vec_cg_to_origin, alpha, beta)
        v = [rotated_vec[i] + centre_of_rotation[i] for i in range(3)]
        return {"v1": v[0], "v2": v[1], "v3": v[2]}
        
    cog = my_transform(baseline_cg[0],baseline_cg[1],baseline_cg[2], alpha, beta)
    centre_of_gravity = [cog[v] for v in ["v1","v2","v3"]]

    return centre_of_gravity

def move_moment_ref_pt(fx, fy, fz, mx, my, mz, pt, new_pt):
    # r = pt - new_pt (vector from new reference point to old reference point)
    rx = pt[0] - new_pt[0]
    ry = pt[1] - new_pt[1]
    rz = pt[2] - new_pt[2]
    # M_new = M_old + r × F
    mx_new = mx + (ry * fz - rz * fy)
    my_new = my + (rz * fx - rx * fz)
    mz_new = mz + (rx * fy - ry * fx)
    return mx_new, my_new, mz_new

def generate_lower_view(row: dict, state: dict, run_dir: Path):

    if os.path.isdir(run_dir):# and (not os.path.exists(os.path.join(dir_name, 'top.png') or force)):
        print(f"Generating top view for {run_dir}...")
        command_template = f"(/apps/ParaView-6.0.0-MPI-Linux-Python3.12-x86_64/bin/pvpython --force-offscreen-rendering --opengl-window-backend EGL scripts/lower_fuse_view.py --run_id {run_id} --num_parallel 5)"
        try:
            subprocess.run(command_template, shell=True, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Failed to submit job in {run_dir}: {e}")
        command_template = f"ffmpeg -framerate 5 -i {run_dir}/images/frame_%04d.png -c:v libx264 -pix_fmt yuv420p images/{run_dir}.mp4"
        try:
            subprocess.run(command_template, shell=True, check=True)
        except subprocess.CalledProcessError as e:
            print(f"Failed to submit job in {run_dir}: {e}")
    else:
        if not os.path.isdir(run_dir):
            print(f"Directory {run_dir} does not exist . Skipping.")
        else:
            print(f"top.png already exists in {run_dir}. Skipping.")

def extract(row: dict, state: dict, run_dir: Path) -> dict:
    """
    Extraction Hook for zCFD
    ----------------------------------
    Extracts the forces and moments in the execution run directory.
    """
    output_file = run_dir / "run_report.csv"
    results = {}
    if output_file.exists():
        df = pd.read_csv(output_file, sep=r"\s+", engine="python")
        half_body = row['Half-Body or Full Body run'] == 'Half-body'
 
        df_mean = df.tail(50).mean().to_frame().T

        area = 0.39250
        speed = row["Airspeed [m/s]"]
        # print(area)
        factor = (0.5*1.225*speed**2*area)
        ref_len = 0.157

        df_mean["Fx [N]"] = df_mean["wall_Fx"] * factor
        df_mean["Fy [N]"] = df_mean["wall_Fy"] * factor
        df_mean["Fz [N]"] = df_mean["wall_Fz"] * factor
        df_mean["Mx [Nm]"] = df_mean["wall_Mx"] * factor * ref_len
        df_mean["My [Nm]"] = df_mean["wall_My"] * factor * ref_len
        df_mean["Mz [Nm]"] = df_mean["wall_Mz"] * factor * ref_len
        if half_body:
            fullbody_forces(df_mean["Fx [N]"], df_mean["Fy [N]"], df_mean["Fz [N]"])
            fullbody_moments(df_mean["Mx [Nm]"], df_mean["My [Nm]"], df_mean["Mz [Nm]"])

        side = df_mean["wall_Fty"][0] * factor
        lift = df_mean["wall_Ftz"][0] * factor
        drag = df_mean["wall_Ftx"][0] * factor
        pitch = df_mean["wall_Mty"][0] * factor * ref_len
        yaw = df_mean["wall_Mtz"][0] * factor * ref_len
        roll = df_mean["wall_Mtx"][0] * factor * ref_len

        # Move moment ref pt from cg to centre of rotation
        centre_of_gravity = [0.23325,0.0,1.24323]
        #centre_of_rotation = [0.0,0.0,0.818]
        #centre_of_rotation = [-0.4,0.0,0.0]

        # roll, pitch, yaw = move_moment_ref_pt(drag, side, lift, roll, pitch, yaw, centre_of_gravity, centre_of_rotation)

        results["Fx [N]"] = df_mean["Fx [N]"][0]
        results["Fy [N]"] = df_mean["Fy [N]"][0]
        results["Fz [N]"] = df_mean["Fz [N]"][0]

        results["Mx [Nm]"] = df_mean["Mx [Nm]"][0]
        results["My [Nm]"] = df_mean["My [Nm]"][0]
        results["Mz [Nm]"] = df_mean["Mz [Nm]"][0]

        results["Side [N]"] = side
        results["Lift [N]"] = lift
        results["Drag [N]"] = drag
        results["L/D"] = lift/drag

        results["Pitch [Nm]"] = pitch
        results["Roll [Nm]"] = roll
        results["Yaw [Nm]"] = yaw
        # print(area)
        results["C_L"] = lift / factor
        results["C_D"] = drag / factor

        results["C_m"] = pitch / (factor*ref_len)

    return results
