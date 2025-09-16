import SwiftUI

struct BulgingSidebarShapeRight: Shape {
    var bulgeCenterY: CGFloat
    var bulgeAmount: CGFloat
    var barWidth: CGFloat
    
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let height = rect.height
        
        // Start top-right
        path.move(to: CGPoint(x: rect.maxX, y: 0))
        path.addLine(to: CGPoint(x: rect.maxX - barWidth, y: 0))
        
        // Curve outward toward mouse Y
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - barWidth, y: height),
            control: CGPoint(x: rect.maxX - barWidth - bulgeAmount, y: bulgeCenterY)
        )
        
        path.addLine(to: CGPoint(x: rect.maxX, y: height))
        path.closeSubpath()
        
        return path
    }
}
