from pathlib import Path
import csv
import os

def float_to_str(val):
    if isinstance(val, float) or isinstance(val, int):
        s = str(abs(val)).replace('.', 'p')
        prefix = 'm' if val < 0 else ''
        return f"{prefix}{s}"
    return str(val)

def get_mesh_root(row):
    half_body = row['Half-Body or Full Body run'] == 'Half-body'
    if half_body:
        mesh_root = "eve_flyover_no_pusher"
    else:
        mesh_root = "eve_flyover_no_pusher"

    if 'Fine' in row['Comment']:
         mesh_root += '_des'

    if 'DES' in row['Comment']:
         mesh_root += '_des'

    mesh_file_root = mesh_root

    # alpha = row['Angle of Attack [°]']

    # alpha = f"_{alpha:g}"

    # mesh_file_root += alpha

    return mesh_root, mesh_file_root


def preprocess(row: dict, state: dict, run_dir: Path) -> None:
    """
    Pre-processing Hook for zCFD
    --------------------------------------
    Takes a row of input parameters and updates run.py in the run directory.
    """
    # mesh_files = ["catalyst.py", 
    #  "disc_lower_starboard.vtp", "disc_upper_starboard.vtp", 
    #  "disc_lower_port.vtp", "disc_upper_port.vtp", 
    #  "RO1_lower_starboard.vtp", "RO1_upper_starboard.vtp",
    #  "RO1_lower_port.vtp", "RO1_upper_port.vtp",
    #  "starboard_lower.vtp", "starboard_upper.vtp",
    #  "port_lower.vtp", "port_upper.vtp"]
    mesh_files = []
    
    # Figure out which mesh files are needed based on the results DataFrame
    mesh_root, mesh_file_root = get_mesh_root(row)
    half_body = row['Half-Body or Full Body run'] == 'Half-body'

    run_template = 'run.py.in'

    if 'DES' in row['Comment']:
         run_template = 'run_des.py.in'

    mesh_files.append(f"{mesh_file_root}_zone.py")

    mesh_files.append(f"{mesh_file_root}.h5")

    # Create a symbolic link to mesh/catalyst.py in dir_name
    for mesh_file in mesh_files:
        src = os.path.abspath(os.path.join('mesh', mesh_file))
        dst = os.path.join(dir_name, mesh_file)
        if not os.path.exists(dst):
            os.symlink(src, dst)

    # Read template, substitute SPEED, and write to run.py
    template_path = os.path.join('template', run_template)
    with open(template_path, 'r') as f:
        template = f.read()
    speed = row['Airspeed [m/s]']
    alpha = row['Angle of Attack [°]']
    beta = row['Angle of Sideslip [°]']
    rpm = row['RPM']

    des = False
    if 'Fine' in row['Comment']:
         template = template.replace('import eve_flyover_no_pusher', 'import eve_flyover_no_pusher_des')
    if 'DES' in row['Comment']:
        des = True
        template = template.replace('import eve_flyover_no_pusher', 'import eve_flyover_no_pusher_des')

    template = template.replace('rpm = RPM', f"rpm = {rpm}")
    template = template.replace('speed = SPEED', f"speed = {speed}")
    template = template.replace('alpha = ALPHA', f"alpha = {alpha}")
    template = template.replace('beta = BETA', f"beta = {beta}")

    if des:
        template = template.replace('"restart": False', '"restart": True')
        src = os.path.join(dir_name, "..", "run_2", "run_results.h5")
        dst = os.path.join(dir_name, "rans_run_results.h5")
        if not os.path.exists(dst):
            os.symlink(src, dst)
        src = os.path.join(dir_name, "..", "run_2", "run_report.csv")
        dst = os.path.join(dir_name, "rans_run_report.csv")
        if not os.path.exists(dst):
            os.symlink(src, dst)

    if row['p [°/s)'] != 0:
        template = template.replace('# ADD_ROTATING_ZONE', 
                                    f"""'FZ_9': {{
                                        'type': 'rotating',
                                        'zone': [12812],
                                        'omega': math.radians({row['p [°/s)']}),
                                        'axis': [0.0, 0.0, 1.0],
                                        'origin': cg,
                                    }},\n""")
    if row['q [°/s]'] != 0:
        template = template.replace('# ADD_ROTATING_ZONE', 
                                    f"""'FZ_9': {{
                                        'type': 'rotating',
                                        'zone': [12812],
                                        'omega': math.radians({row['q [°/s]']}),
                                        'axis': [1.0, 0.0, 0.0],
                                        'origin': cg,
                                    }},\n""")
    if row['r [°/s]'] != 0:
        template = template.replace('# ADD_ROTATING_ZONE', 
                                    f"""'FZ_9': {{
                                        'type': 'rotating',
                                        'zone': [12812],
                                        'omega': math.radians({row['r [°/s]']}),
                                        'axis': [0.0, 1.0, 0.0],
                                        'origin': cg,
                                    }},\n""")


    with open(os.path.join(dir_name, 'run.py'), 'w') as f:
        f.write(template)
