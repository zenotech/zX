import React, { useState, useEffect } from 'react';
import { 
  X, ChevronLeft, ChevronRight, Compass, Sparkles, 
  CheckCircle, ArrowRight, Play, Info
} from 'lucide-react';

interface TourStep {
  title: string;
  content: string | React.ReactNode;
  selector: string | null;
  view?: 'grid' | 'editor' | 'dashboard' | 'terminal' | 'explorer' | 'state' | 'backup';
}

interface TutorialOverlayProps {
  activeView: 'grid' | 'editor' | 'dashboard' | 'terminal' | 'explorer' | 'state' | 'backup';
  setActiveView: (view: 'grid' | 'editor' | 'dashboard' | 'terminal' | 'explorer' | 'state' | 'backup') => void;
  activeProject: string;
  theme: 'light' | 'dark';
  onClose: () => void;
}

export default function TutorialOverlay({
  activeView,
  setActiveView,
  activeProject,
  theme,
  onClose
}: TutorialOverlayProps) {
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Define interactive step definitions (starts after project selection is complete)
  const steps: TourStep[] = [
    {
      title: "Welcome to zX Exploration! 👋",
      content: (
        <div>
          <p className="mb-3" style={{ fontSize: '13.5px', lineHeight: '1.6' }}>
            zX is an advanced multi-stage parametric study and simulation optimization shell. You are currently viewing your loaded workspace!
          </p>
          <p className="mb-0 text-secondary" style={{ fontSize: '12px', fontStyle: 'italic' }}>
            Let's take a quick interactive 2-minute tour of your active environment to see how it works!
          </p>
        </div>
      ),
      selector: null
    },
    {
      title: "1. Workspace & Server Status 📂",
      content: "This is your active Project Workspace. The status bar keeps track of your sidecar server connection (local or remote SSH supercomputer) and showing execution statuses.",
      selector: '#layout-statusbar'
    },
    {
      title: "2. Navigation Command Center 🧭",
      content: "Use this sidebar to toggle between different modules. As we proceed through the tour, the active view will automatically change in real-time to show you each feature!",
      selector: '#layout-sidebar'
    },
    {
      title: "3. Parameter Study Grid 📊",
      content: "The Parameter Grid is your main spreadsheet command center. Append rows, configure design parameters, and trigger execution of stages (Preprocess, Launch, Extract, Explore) sequentially or in parallel.",
      selector: '#layout-content',
      view: 'grid'
    },
    {
      title: "4. Custom Python Hooks 🐍",
      content: "Need custom automation? Edit Python Scripts for Preprocessing, solver execution, Extraction, and Optimization. Leverages Google Gemini for lightning-fast autocomplete and suggestions!",
      selector: '#layout-content',
      view: 'editor'
    },
    {
      title: "5. Shared Global State ⚙️",
      content: "Manage global variables passed into your python scripts, toggle Slurm distributed scheduling, specify max optimization loops, or add your custom parameters dynamically.",
      selector: '#layout-content',
      view: 'state'
    },
    {
      title: "6. Interactive Visualization 📈",
      content: "Keep track of optimization progress, objective functions, or convergence paths. High-fidelity Plotly charts sync immediately with running background processes.",
      selector: '#layout-content',
      view: 'dashboard'
    },
    {
      title: "7. Integrated Split Terminal 💻",
      content: "Direct access to local and remote terminal processes. Inspect Sidecar runner logs, standard output, and process status in real-time.",
      selector: '#layout-content',
      view: 'terminal'
    },
    {
      title: "8. Workspace File Explorer 📁",
      content: "Browse the workspace tree directory to inspect output CSV files, logs, generated files, and state parameters directly from the browser window.",
      selector: '#layout-content',
      view: 'explorer'
    },
    {
      title: "Congratulations! 🎉",
      content: (
        <div>
          <p className="mb-3" style={{ fontSize: '13.5px', lineHeight: '1.6' }}>
            You've completed the tour! You are now equipped to build, run, and optimize parametric studies with zX.
          </p>
          <div className="d-flex align-items-center gap-2 p-2 rounded" style={{ background: 'var(--accent-cyan-glow)', border: '1px dashed var(--accent-cyan)', marginBottom: '12px' }}>
            <Sparkles size={16} style={{ color: 'var(--accent-cyan)' }} />
            <span style={{ fontSize: '11px', fontWeight: 'bold' }}>Try editing hooks and running a grid study!</span>
          </div>
        </div>
      ),
      selector: null
    }
  ];

  const currentTourStep = steps[currentStep];

  // Dynamically calculate bounding rectangle of the target element
  useEffect(() => {
    const updateRect = () => {
      if (currentTourStep && currentTourStep.selector) {
        const el = document.querySelector(currentTourStep.selector);
        if (el) {
          setRect(el.getBoundingClientRect());
          return;
        }
      }
      setRect(null);
    };

    updateRect();
    window.addEventListener('resize', updateRect);

    // Periodically recheck in case views are transitioning or mounting
    const timer = setTimeout(updateRect, 350);

    return () => {
      window.removeEventListener('resize', updateRect);
      clearTimeout(timer);
    };
  }, [currentStep, activeView, currentTourStep]);

  // If a step requires a specific view, switch to it automatically
  useEffect(() => {
    if (currentTourStep && currentTourStep.view && activeProject) {
      setActiveView(currentTourStep.view);
    }
  }, [currentStep, activeProject]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      handleComplete();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleComplete = () => {
    localStorage.setItem('zx-tour-completed', 'true');
    onClose();
  };

  // Helper function to position the floating card next to the highlighted element
  const getCardPositionStyle = () => {
    if (!rect) {
      return {
        position: 'fixed' as const,
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        width: '420px'
      };
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Position to the right of the element as default
    let left = rect.right + 20;
    let top = rect.top + (rect.height / 2) - 150; // Center vertically relative to element

    // Adjustments for specific elements to look best
    if (currentTourStep.selector === '#layout-sidebar') {
      left = rect.right + 20;
      top = rect.top + 60;
    } else if (currentTourStep.selector === '#layout-statusbar') {
      left = rect.left + 20;
      top = rect.top - 290; // Position above status bar
    }

    // boundary limits so popover never leaves the viewport
    if (left + 360 > viewportWidth) {
      left = rect.left - 360 - 20; // Flip to left side
    }
    if (top + 280 > viewportHeight) {
      top = viewportHeight - 280 - 20;
    }
    
    left = Math.max(20, Math.min(left, viewportWidth - 360 - 20));
    top = Math.max(20, Math.min(top, viewportHeight - 280 - 20));

    return {
      position: 'fixed' as const,
      left: `${left}px`,
      top: `${top}px`,
      width: '360px',
      zIndex: 9999,
      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
    };
  };

  const hasHighlight = rect !== null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9990 }}>
      {/* 1. DARK CUTOUT BACKDROP */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: hasHighlight ? 'transparent' : 'rgba(5, 6, 8, 0.75)',
          backdropFilter: hasHighlight ? 'none' : 'blur(4px)',
          zIndex: 9991,
          pointerEvents: 'auto' // capture clicks when full overlay is active
        }}
        onClick={handleComplete}
      />

      {/* 2. DYNAMIC SHADOW OVERLAY CUTOUT FOR HIGHLIGHTS */}
      {hasHighlight && rect && (
        <div 
          className="tour-pulse-glow"
          style={{
            position: 'fixed',
            top: rect.top - 8,
            left: rect.left - 8,
            width: rect.width + 16,
            height: rect.height + 16,
            borderRadius: '10px',
            border: '2px solid var(--accent-cyan)',
            pointerEvents: 'none',
            zIndex: 9992,
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        />
      )}

      {/* 3. TOUR POPUP CARD */}
      <div 
        className="tour-card tour-bounce-slow"
        style={{
          ...getCardPositionStyle(),
          pointerEvents: 'auto', // enable interaction with buttons
          zIndex: 9993
        }}
      >
        {/* HEADER */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <span className="tour-badge d-flex align-items-center gap-1">
            <Compass size={12} /> Interactive Tour
          </span>
          <button 
            onClick={handleComplete}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '2px',
              borderRadius: '4px',
              transition: 'all 0.15s',
              marginLeft: 'auto'
            }}
            title="Skip Tour"
          >
            <X size={16} />
          </button>
        </div>

        {/* TITLE & CONTENT */}
        <h4 style={{ fontSize: '16px', fontWeight: 'bold', color: 'var(--text-primary)', marginBottom: '10px' }}>
          {currentTourStep.title}
        </h4>
        <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '24px', minHeight: '60px', lineHeight: '1.5' }}>
          {typeof currentTourStep.content === 'string' ? <p>{currentTourStep.content}</p> : currentTourStep.content}
        </div>

        {/* ACTIONS & PROGRESS */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
          {/* STEP INDICATORS */}
          <div style={{ display: 'flex', gap: '5px' }}>
            {steps.map((_, idx) => (
              <div 
                key={idx} 
                className={`tour-step-dot ${idx === currentStep ? 'active' : ''}`}
                style={{ cursor: idx < currentStep ? 'pointer' : 'default' }}
                onClick={() => {
                  if (idx < currentStep) {
                    setCurrentStep(idx);
                  }
                }}
              />
            ))}
          </div>

          {/* BACK & NEXT BUTTONS */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {currentStep > 0 && (
              <button 
                onClick={handleBack}
                className="btn btn-sm btn-outline-secondary py-1 px-3 d-flex align-items-center gap-1"
                style={{ fontSize: '12px', background: 'transparent' }}
              >
                <ChevronLeft size={14} /> Back
              </button>
            )}
            
            <button 
              onClick={handleNext}
              className="btn btn-sm btn-primary py-1 px-3 d-flex align-items-center gap-1"
              style={{ fontSize: '12px', fontWeight: 'bold' }}
            >
              {currentStep === steps.length - 1 ? (
                <>Finish <CheckCircle size={14} /></>
              ) : (
                <>Next <ChevronRight size={14} /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
